// awriq-agent — وقت تشغيل الوكيل على الخادم (Backend Agent Runtime).
// العقل: DeepSeek (افتراضيًا عبر env) ثم سلسلة مزوّدات؛ التنفيذ: طبقة الأدوات الحقيقية.
// المفاتيح (DeepSeek / GitHub / Vercel / Service) تبقى داخل الخادم، ولا تصل الواجهة أو المزوّد مطلقًا.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { DeepSeekProvider, OpenAICompatProvider, ProviderError, type ChatMessage, type ProviderStep } from "./providers.ts";
import { runTool, TOOL_DEFS, applyApproval, type AgentToolCtx } from "./tools.ts";

const ALLOWED_ORIGINS = ["https://awriq-awriq1.vercel.app", "http://localhost:5173"];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MASTER_KEY = Deno.env.get("PAX_MASTER_KEY") ?? "";
const DEEPSEEK_KEY = Deno.env.get("DEEPSEEK_API_KEY") ?? "";
const DEEPSEEK_MODEL = Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-flash";

const PRICES: Record<string, { in: number; out: number }> = {
  "deepseek-flash": { in: 0.25, out: 0.6 },
  "deepseek-v4-pro": { in: 1.5, out: 4.0 },
};

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---------- crypto (نفس مخطط PAX_MASTER_KEY) ----------
function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
async function paxKey(namespace: string): Promise<Uint8Array> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${MASTER_KEY}:${namespace}`));
  return new Uint8Array(d);
}
async function decryptPax(namespace: string, value: string | null | undefined): Promise<string | null> {
  if (!value || !value.startsWith("enc:v1:")) return null;
  const parts = value.split(":");
  if (parts.length < 4) return null;
  try {
    const key = await crypto.subtle.importKey("raw", (await paxKey(namespace)) as unknown as ArrayBuffer, "AES-GCM", false, ["decrypt"]);
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64uDecode(parts[2]) as unknown as ArrayBuffer }, key, b64uDecode(parts[3]) as unknown as ArrayBuffer);
    return new TextDecoder().decode(buf);
  } catch { return null; }
}

// ---------- SSE ----------
function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}
function sseWriter(origin: string) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  return {
    stream: readable,
    async emit(type: string, data: unknown) {
      try { await writer.write(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* closed */ }
    },
    async close() { try { await writer.close(); } catch { /* closed */ } },
  };
}

// ---------- auth ----------
async function authUser(req: Request): Promise<{ id: string; roles: string[]; projectIds: string[] } | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer eyJ")) return null;
  const token = auth.slice(7);
  const { data: u, error } = await supabase.auth.getUser(token);
  if (error || !u?.user) return null;
  const roles: string[] = [];
  const { data: rr } = await supabase.from("user_roles").select("roles(name)").eq("user_id", u.user.id);
  for (const r of (rr ?? []) as any[]) if (r?.roles?.name) roles.push(String(r.roles.name));
  const projectIds: string[] = [];
  const { data: pm } = await supabase.from("project_members").select("project_id").eq("user_id", u.user.id).eq("role", "owner");
  for (const p of pm ?? []) if (p?.project_id) projectIds.push(p.project_id);
  return { id: u.user.id, roles, projectIds };
}

// ---------- موجه المهام (Tool Router) ----------
type TaskId = "db" | "code" | "git" | "deploy" | "repo";

const TASK: Record<TaskId, { strategy: string; tools: string[]; budget: number }> = {
  db: {
    strategy: "خطة بيانات (DB-first): كل مدارس/مؤسسات/جلسات/سجلات = جداول قاعدة بيانات AWRIQ. استخدم db_select (مع where/like) ثم db_describe عند الحاجة. لا تمسح ملفات ولا تبحث في مستودعات عن بيانات. لأمر حذف: db_select للبحث ثم db_delete وتوقف لموافقة.",
    tools: ["db_select", "db_describe", "db_delete"],
    budget: 6,
  },
  code: {
    strategy: "خطة كود: حدد الملفات المستهدفة (search_files داخل مجلد محدد أو read_file لمسار معروف)، ثم عدّل بـ edit/patch أو أنشئ بـ write. تحقق read_file بعد أي تعديل، وشغّل التحقق عبر setup_shell ثم shell (build/test). عمليات حذف ملف (rm) حساسة وتتوقف لموافقة. لا تسرد جذور المشاريع.",
    tools: ["list_files", "read_file", "search_files", "edit", "write", "patch", "rm", "shell", "setup_shell", "git_status", "git_diff", "github_repo"],
    budget: 14,
  },
  git: {
    strategy: "خطة Git: اقرأ الحالة/الفرق/الفروع وعمليات الفرع (git_branch/git_checkout). الدفع (git_push) حساس ويتوقف لموافقة. لا تعدّل ملفات إلا أن تطلب المهمة.",
    tools: ["git_status", "git_diff", "git_branch", "git_checkout", "git_push", "read_file", "list_files", "github_repo"],
    budget: 6,
  },
  deploy: {
    strategy: "خطة نشر: تحقق من آخر النشرات (vercel_list) ثم أبلغ الحالة. النشر الفعلي (vercel_deploy) حساس ويتوقف لموافقة. لا تنشر ما لم تطلب المهمة صراحةً.",
    tools: ["vercel_list", "vercel_deploy", "git_status", "read_file", "list_files", "github_repo"],
    budget: 5,
  },
  repo: {
    strategy: "خطة تصفّح: استخدم list_files لمجلد محدد و read_file/search_files للوصول الدقيق و git_status/github_repo للمستودع و db_describe للجداول. لا تمسح جذر المشروع أو كل الملفات.",
    tools: ["list_files", "read_file", "search_files", "git_status", "git_branch", "github_repo", "db_describe"],
    budget: 8,
  },
};

function classifyMessage(msg: string): TaskId {
  const t = msg ?? "";
  const count = (arr: string[]) => arr.filter((k) => t.includes(k)).length;
  // كلمات البيانات: لا تُحسب كمهمة بيانات إلا مع كلمة بيانات فعلية
  const dbNouns = ["مدرس", "مؤسسات", "مؤسسة", "طالب", "طلاب", "جلسة", "جلسات", "معلم", "سجل", "بيانات", "جدول", "قاعدة بيانات", "حضور", "ذكر"];
  const dbActions = ["حذف", "احذف", "أضف", "إضافة", "عرض", "اعرض", "عدّل", "تعديل", "ابحث", "كم عدد", "تعريف", "أسماء", "قائمة", "أنشئ", "إنشاء"];
  const codeWords = ["login", "إصلاح", "مشكلة", "خطأ", "bug", "ميزة", "feature", "كود", "دالة", "تعمل", "فحص", "ملف", "مجلد", "مستودع", "اختبار", "build", "test", "npm", "أمر", "shell", "شغّل", "patch", "edit", "write", "اكتب", "ts", "tsx", "css"];
  const gitWords = ["status", "commit", "التزام", "فرع", "branch", "push", "merge", "دمج", "diff", "checkout"];
  const depWords = ["نشر", "deploy", "vercel", "إطلاق", "production", "back to live"];
  const dbN = count(dbNouns);
  const db = dbN > 0 ? dbN + count(dbActions) : 0;
  const code = count(codeWords);
  const git = count(gitWords);
  const dep = count(depWords);
  const scores: Array<[TaskId, number]> = [["db", db], ["code", code], ["git", git], ["deploy", dep]];
  const top = scores.sort((a, b) => b[1] - a[1])[0];
  return top[1] > 0 ? top[0] : "repo";
}

// ---------- ملف جانبي للمخطط (Schema Profile) مع كاش ----------
const PROF_SCHEMA = "v1";
async function getProjectProfile(projectId: string): Promise<any> {
  const { data: proj } = await supabase.from("projects").select("agent_profile").eq("id", projectId).maybeSingle();
  const cached = proj?.agent_profile as any;
  if (cached?.schema === PROF_SCHEMA && cached?.builtAt && Date.now() - new Date(cached.builtAt).getTime() < 3600_000) return cached;
  const count = async (t: string) => (await supabase.from(t).select("id", { count: "exact", head: true })).count ?? 0;
  const [institutions, sessions, admins, activeSessions] = await Promise.all([
    count("institutions"),
    count("sessions"),
    count("institution_admins"),
    (await supabase.from("sessions").select("id", { count: "exact", head: true }).eq("status", "active")).count ?? 0,
  ]);
  const profile = { schema: PROF_SCHEMA, builtAt: new Date().toISOString(), data: { institutions, sessions, institution_admins: admins, active_sessions: activeSessions } };
  await supabase.from("projects").update({ agent_profile: profile }).eq("id", projectId).then(() => {}, () => {});
  return profile;
}

// ---------- context ----------
function buildSystem(project: any, mode: string, repo: { owner: string; repo: string; branch: string } | null, task: TaskId, profile: any): string {
  const t = TASK[task];
  const profileInfo = profile?.data
    ? `ملف جانب واحد لـ AWRIQ (الأرقام من DB): مدارس (institutions): ${profile.data.institutions}، جلسات (sessions): ${profile.data.sessions} (نشطة ${profile.data.active_sessions})، أمناء مؤسسات: ${profile.data.institution_admins}.`
    : "";
  return `أنت AWRIQ Agent. تعمل فقط على المشروع المحدد في هذه الجلسة.
أهدافك الصارمة:
- لا تدّعِ تنفيذ أي عملية لم تنفذها فعليًا. أبلغ النتائج كما هي (أو فشلها) بصدق.
- للتنفيذ استخدم الأدوات؛ لا تكتب "سأشغّل" كنص.
- البيانات (مدرسة/مؤسسة/جلسة/طالب/سجل) = جداول قاعدة البيانات. مؤسسات = "المدارس". استخدم db_select دائمًا للبيانات، ولا تبحث عن بيانات في المستودعات أبدًا.
- حذف سجل = db_delete (يطلب موافقة)؛ أي حذف فعلي ينتظر الموافقة.
- بعد تعديل ملف تحقق (read_file). بعد فشل أمر build/test لا تقل إنها انتهت؛ وضح الفشل واصلحه.
- العمليات الحساسة (تعديل/حذف ملف، دفع git، نشر، حذف سجل/صف) تطلب موافقة تلقائيًا وتوقف التنفيذ حتى يجري المستخدم القرار — استدعِ الأداة ثم توقف وانتظر.
- لا تصل إلى مشروع آخر. لا تكشف أسرارًا (توكنات/مفاتيح) في ردودك.
- عندما تنتهي المهمة بأي نتيجة (نجاح أو فشل) أبلغها بإيجاز ولا تحتفظ بخطوات زائدة.

سياق المشروع:
- اسم المشروع: ${project?.name ?? "غير محدد"}
- المستودع: ${repo ? `${repo.owner}/${repo.repo}` : "غير مربوط"} (الفرع: ${repo?.branch ?? "؟"})
- وضع الأدوات: ${mode === "read" ? "قراءة فقط" : mode === "plan" ? "قراءة + تخطيط (لا تعديل)" : "تعديل بموافقة"}
${profileInfo}
مهمتك المحددة تصنيفها: «${task}» — ${t.strategy}
أدواتك المسموحة فقط: ${t.tools.join(", ")} (ميزانية الأدوات: ${t.budget}).

إذا لم يُنفَّذ شيء (لا credential/خطأ أداة) انقل الخطأ كما ورد من النظام. لا تخترع نتيجة.`;
}

// ---------- agent loop ----------
interface RunRequest {
  project_id: string;
  message?: string;
  history?: ChatMessage[];
  mode?: "read" | "plan" | "edit_approval" | "edit_auto";
  repo?: { owner: string; repo: string; branch: string } | null;
  max_steps?: number;
  approve_approval_id?: string | null;
  reject_approval_id?: string | null;
}

async function resolveApproval(ctx: AgentToolCtx, approvalId: string, decision: "approve" | "reject"): Promise<string> {
  const { data } = await ctx.supabase.from("agent_approvals").select("payload, action_type, status, project_id").eq("id", approvalId).maybeSingle();
  if (!data?.payload) return "طلب الموافقة غير معثور عليه.";
  if (String(data.project_id) !== String(ctx.projectId)) return "طلب الموافقة لا يخص هذا المشروع — لم يُنفَّذ.";
  if (data.status !== "pending") return `الطلب مُعالَج مسبقًا (${data.status}) — لم يُنفَّذ مرة أخرى.`;
  const act: any = data.payload;
  if (decision === "reject") {
    const { error: uerr } = await ctx.supabase.from("agent_approvals").update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: ctx.requestUserId }).eq("id", approvalId).eq("status", "pending");
    if (uerr) return `لم يُحفظ رفض الموافقة: ${uerr.message}`;
    return `رفضت الموافقة — لم يُنفَّذ أي تغيير للعملية «${String(act.action ?? data.action_type ?? "؟")}».`;
  }
  const applied = await applyApproval(ctx, act);
  await ctx.supabase.from("agent_approvals").update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: ctx.requestUserId }).eq("id", approvalId).eq("status", "pending");
  return applied;
}

async function runOnce(body: RunRequest, user: { id: string; roles: string[]; projectIds: string[] }): Promise<Response> {
  const origin = "https://awriq-awriq1.vercel.app";
  const sse = sseWriter(origin);

  (async () => {
    const mode = body.mode ?? "read";
    const maxSteps = Math.min(Math.max(body.max_steps ?? 12, 1), 25);
    const started = Date.now();
    const logStarted = new Date().toISOString();

    try {
      // project
      const { data: project, error: pErr } = await supabase.from("projects").select("id, name, project_type, github_repo, github_branch").eq("id", body.project_id).maybeSingle();
      if (pErr || !project) { await sse.emit("agent.error", { message: "Project not found.", kind: "model" }); return; }
      const isSuper = user.roles.includes("super_admin");
      const isOwner = user.projectIds.includes(String(project.id));
      if (!isSuper && !isOwner) { await sse.emit("agent.error", { message: "Not authorized for this project.", kind: "auth" }); return; }

      // repo + credentials (من خزنة server-side، مشفّرة)
      const repo = body.repo ??
        (project.github_repo ? (() => { const [owner, repo2] = String(project.github_repo).split("/"); return owner && repo2 ? { owner, repo: repo2, branch: project.github_branch ?? "HEAD" } : null; })() : null);
      const { data: creds } = await supabase.from("project_credentials").select("*").eq("project_id", body.project_id).maybeSingle();
      const gitToken = creds ? await decryptPax(String(project.id), creds.github_token) : null;
      const vercelToken = creds ? await decryptPax(String(project.id), creds.vercel_token) : null;
      const vercelProjectId = creds?.vercel_project_id ?? null;

      const ctx: AgentToolCtx = {
        repo,
        gitToken,
        vercelToken,
        vercelProjectId: vercelProjectId ? String(vercelProjectId) : null,
        supabase,
        serviceKey: SERVICE_KEY,
        mode,
        projectId: String(project.id),
        requestUserId: user.id,
        cache: { tree: null },
      };

      // موجه المهام + ميزانيات + الملف الجانبي
      let task: TaskId;
      if (body.approve_approval_id) {
        const { data: ap } = await supabase.from("agent_approvals").select("payload, action_type, status, project_id").eq("id", String(body.approve_approval_id)).maybeSingle();
        if (!ap) { await sse.emit("approval.resolved", { id: String(body.approve_approval_id), decision: "reject", text: "طلب الموافقة غير موجود." }); await sse.emit("agent.error", { message: "Approval not found.", kind: "auth" }); return; }
        if (String(ap.project_id) !== String(project.id)) { await sse.emit("agent.error", { message: "Approval belongs to another project.", kind: "auth" }); return; }
        if (ap.status !== "pending") { await sse.emit("approval.resolved", { id: String(body.approve_approval_id), decision: "reject", text: `الطلب مُعالَج مسبقًا (${ap.status}).` }); return; }
        const aaction = String((ap.payload as any)?.action ?? ap.action_type ?? "");
        task = aaction === "db_delete" ? "db"
          : aaction === "vercel_deploy" || ap.action_type === "deploy" ? "deploy"
          : ap.action_type === "file_modify" ? "code"
          : aaction.startsWith("git_") || ap.action_type === "git" ? "git"
          : "repo";
      } else {
        task = classifyMessage(body.message ?? "");
      }
      const tmeta = TASK[task];
      const allowedTools = new Set(tmeta.tools);
      const allowedDefs = TOOL_DEFS.filter((d: any) => allowedTools.has(d.function.name));
      const toolCap = tmeta.budget;
      const runId = crypto.randomUUID();
      const deadline = started + 170_000;
      const profile = await getProjectProfile(String(project.id));

      // نظام prompt + رسائل
      const EMPTY_USAGE = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const system = buildSystem(project, mode, repo, task, profile);
      const history = (body.history ?? []).slice(-40).map((h) => ({ ...h }));
      const messages: ChatMessage[] = [{ role: "system", content: system }, ...history];

      let totalUsage = { ...EMPTY_USAGE };
      let finalText = "";
      const actions: any[] = [];
      const filesChanged: string[] = [];
      const commands: string[] = [];
      let status: string = "success";
      let lastError: string | null = null;
      let waitingApproval = false;
      let toolCalls = 0;
      let resolvedLabel: string | undefined;
      let emptyRetries = 0;

      // قرار موافقة معلّق (موافقة/رفض) قبل بدء حلقة الوكيل
      if (body.approve_approval_id || body.reject_approval_id) {
        const decision = body.approve_approval_id ? "approve" : "reject";
        const aid = String(body.approve_approval_id ?? body.reject_approval_id);
        const resolved = await resolveApproval(ctx, aid, decision);
        await sse.emit("approval.resolved", { id: aid, decision, text: resolved });
        if (decision === "reject") {
          await sse.emit("agent.completed", { provider: "AWRIQ", text: resolved, usage: EMPTY_USAGE, costEst: estimateCost(EMPTY_USAGE), durationMs: Date.now() - started, rejected: true });
          return;
        }
        await sse.emit("run.start", { runId, task, tools: tmeta.tools, maxSteps, toolCap, deadlineMs: deadline - started, strategy: tmeta.strategy, approval: aid });
        await sse.emit("message.start", { runId, step: 1, task, approval: aid });
        messages.push({ role: "user", content: `قرار الموافقة: ${resolved} — تابع باقي المهمة بصدق وبالتحقق الفعلي.` });
      } else {
        await sse.emit("run.start", { runId, task, tools: tmeta.tools, maxSteps, toolCap, deadlineMs: deadline - started, strategy: tmeta.strategy });
        await sse.emit("message.start", { runId, step: 1, task });
        if (body.message && body.message.trim()) {
          messages.push({ role: "user", content: body.message.trim() });
        }
      }

      // provider chain: DeepSeek أولاً (env) ثم سلسلة الخزنة
      const chain: Array<{ label: string; stream: (msgs: ChatMessage[]) => Promise<ProviderStep> }> = [];
      if (DEEPSEEK_KEY) {
        const ds = new DeepSeekProvider(DEEPSEEK_KEY, DEEPSEEK_MODEL);
        chain.push({
          label: ds.label,
          stream: (msgs) => ds.stream(msgs, { tools: allowedDefs as any, maxTokens: 8192 }),
        });
      }
      const { data: provRows } = await supabase.from("ai_providers").select("id, code, name, base_url, config").eq("is_enabled", true).order("priority", { ascending: true });
      for (const p of provRows ?? []) {
        if (p.config?.server_managed !== true) continue;
        if (p.code === "deepseek" && DEEPSEEK_KEY) continue; // env هو الأساسي
        const { data: sec } = await supabase.from("ai_provider_secrets").select("encrypted_secret").eq("provider_id", p.id).is("project_id", null).limit(1);
        const apiKey = sec?.[0] ? await decryptPax(String(p.id), sec[0].encrypted_secret) : null;
        if (!apiKey) continue;
        const model = p.code === "gemini" ? "gemini-2.5-flash" : null;
        if (!model) continue;
        const prov = new OpenAICompatProvider({ base: p.base_url, apiKey, model, label: p.name ?? p.code });
        chain.push({ label: prov.label, stream: (msgs) => prov.stream(msgs, { tools: allowedDefs as any, maxTokens: 8192 }) });
      }

      for (let step = 0; step < maxSteps; step++) {
        const elapsed = Date.now() - started;
        if (toolCalls >= toolCap || elapsed >= deadline) {
          status = "success";
          const why = toolCalls >= toolCap ? "بلغت ميزانية الأدوات المخصصة" : "اقتربت مهمتك من حد مدة التنفيذ (الخادم سيغلق)";
          finalText = `أوقفت التنفيذ (${why}) بعد ${toolCalls} استدعاء أداة — نُجزت جزئيًا: ${actions.filter((a) => a.ok).length}/${actions.length} ناجح. إن احتاج الأمر خطوات أكثر فقسم المهمة.`;
          await sse.emit("agent.completed", { provider: resolvedLabel ?? "AWRIQ", text: finalText, usage: totalUsage, costEst: estimateCost(totalUsage), durationMs: Date.now() - started, truncated: true, because: why });
          break;
        }

        let resolved: { label: string; step: ProviderStep } | null = null;
        let chainErr: { kind: string; msg: string } | null = null;
        const chainLog: string[] = [];
        for (const p of chain) {
          try {
            const s = await p.stream(messages);
            resolved = { label: p.label, step: s };
            break;
          } catch (e) {
            const kind = e instanceof ProviderError ? e.kind : "unknown";
            chainErr = { kind, msg: e instanceof Error ? e.message : String(e) };
            chainLog.push(`${p.label}: ${chainErr.msg}`);
          }
        }
        if (!resolved) {
          status = "error";
          lastError = `All AI providers failed. آخر خطأ: ${chainErr?.msg ?? "غير معروف"}`;
          await sse.emit("agent.error", { message: `${chainLog.join(" | ")}`, kind: chainErr?.kind ?? "unknown" });
          return;
        }
        const { label, step: providerStep } = resolved;
        resolvedLabel = label;
        if (providerStep.usage) { totalUsage.prompt_tokens += providerStep.usage.prompt_tokens; totalUsage.completion_tokens += providerStep.usage.completion_tokens; totalUsage.total_tokens += providerStep.usage.total_tokens; }
        if (providerStep.text) await sse.emit("assistant.delta", { text: providerStep.text });

        if (providerStep.toolCalls.length === 0) {
          const txt = providerStep.text?.trim();
          const canRetry = !txt && emptyRetries < 2 && toolCalls < toolCap && Date.now() < deadline;
          if (canRetry) {
            emptyRetries++;
            messages.push({ role: "assistant", content: "" });
            messages.push({ role: "user", content: "لم يصل ردّ نصي. نفّذ الأدوات اللازمة للمهمة الآن، وإن انتهت فاذكر النتيجة النهائية بوضوح في سطرين." });
            continue;
          }
          finalText = txt || `لم يُرجع النموذج ردًا نصيًا. ما نُفِّذ فعليًا: ${actions.length ? actions.map((a) => `${a.tool}:${a.ok ? "نجاح" : "فشل"}`).join("، ") : "لا شيء بعد"}. أعد صياغة الطلب أو اطلب استمرارًا.`;
          await sse.emit("agent.completed", { provider: label, text: finalText, usage: totalUsage, costEst: estimateCost(totalUsage), durationMs: Date.now() - started, emptyText: !txt });
          break;
        }

        for (const tc of providerStep.toolCalls) {
          let result: import("./tools.ts").ToolResult;
          const notAllowed = !allowedTools.has(tc.name);
          if (notAllowed) {
            result = { ok: false, output: `أداة «${tc.name}» خارج نطاق مهمة «${task}» (المسموح: ${tmeta.tools.join(", ")}) — التزم بخطة المهمة.`, events: [], errorType: "invalid" };
          } else {
            toolCalls++;
            await sse.emit("tool.start", { id: tc.id, name: tc.name, args: safeArgs(tc.arguments) });
            result = await runTool(tc.name, tc.arguments, ctx);
          }
          for (const ev of result.events) {
            if (ev.fileChanged) { filesChanged.push(ev.fileChanged.path); await sse.emit("file.changed", ev.fileChanged); }
            if (ev.approvalRequired) {
              waitingApproval = true;
              await sse.emit("approval.required", { ...ev.approvalRequired, project: { id: String(project.id), name: String(project.name ?? "") } });
            }
            if (ev.commandDispatched) { await sse.emit("command.dispatched", ev.commandDispatched); }
            if (ev.terminal) { commands.push(ev.terminal.command); await sse.emit("terminal", ev.terminal); }
          }
          await sse.emit("tool.completed", { id: tc.id, name: tc.name, ok: result.ok, output: unsafePreview(result.output), errorType: result.errorType, statusCode: result.statusCode ?? null, durationMs: result.durationMs ?? null, retried: result.retried ?? false });
          actions.push({ tool: tc.name, ok: result.ok, errorType: result.errorType ?? null });
          const assistantMsg: ChatMessage = {
            role: "assistant",
            content: null,
            tool_calls: [{ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } }],
          };
          // DeepSeek thinking-mode contract: reasoning_content يجب أن يُعاد للإرسال. (دونه: HTTP 400)
          if (providerStep.reasoning) (assistantMsg as any).reasoning_content = providerStep.reasoning;
          messages.push(assistantMsg);
          messages.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content: result.output.slice(0, 20000) });
        }

        if (waitingApproval) { status = "approval_pending"; finalText = "انتظار موافقة المستخدم."; await sse.emit("agent.completed", { provider: label, text: finalText, usage: totalUsage, costEst: estimateCost(totalUsage), durationMs: Date.now() - started, waitingApproval: true }); break; }

        if (step === maxSteps - 1) {
          status = "success";
          finalText = "بلغت حد الخطوات قبل الإنهاء (قسم المهمة أو اطلب استمرارًا).";
          await sse.emit("agent.completed", { provider: label, text: finalText, usage: totalUsage, costEst: estimateCost(totalUsage), durationMs: Date.now() - started, truncated: true, because: "max_steps" });
        }
      }

      // تسجيل حقيقي
      await supabase.from("agent_runs").insert({
        project_id: project.id,
        user_id: user.id,
        status,
        actions,
        commands,
        files_changed: filesChanged,
        tests_run: commands.some((c) => /test/i.test(c)),
        result: finalText || null,
        error: lastError,
        usage_info: { tokens: totalUsage, cost_est: estimateCost(totalUsage), started_at: logStarted, duration_ms: Date.now() - started, task },
      }).then(() => {}, () => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const safe = msg.replace(/sk-[A-Za-z0-9_-]{12,}/g, "[secret]").replace(/Bearer\s+ey[A-Za-z0-9._-]+/g, "[token]");
      await sse.emit("agent.error", { message: safe, kind: "unknown" });
    } finally {
      await sse.close();
    }
  })();

  return new Response(sse.stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      ...cors(origin),
    },
  });
}

function safeArgs(args: string): string {
  return args.replace(/sk-[A-Za-z0-9_-]{12,}/g, "[secret]").replace(/(\w{20,50})(?=")/g, "[token]");
}
function unsafePreview(output: string): string {
  return output.length > 500 ? output.slice(0, 500) + "…" : output;
}
function estimateCost(usage: { prompt_tokens: number; completion_tokens: number }): { $: number; note: string } {
  const p = PRICES[DEEPSEEK_MODEL] ?? { in: 0.25, out: 0.6 };
  const usd = usage.prompt_tokens / 1e6 * p.in + usage.completion_tokens / 1e6 * p.out;
  return { $: Number((usd).toFixed(5)), note: `تقدير تقريبي بسعر ${DEEPSEEK_MODEL}` };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (req.method === "GET" && new URL(req.url).pathname === "/health") {
    const configured = Boolean(DEEPSEEK_KEY);
    return new Response(JSON.stringify({
      ok: configured,
      message: configured ? "DeepSeek provider is configured." : "DeepSeek provider is not configured.",
      primary: configured ? "DeepSeek" : null,
      model: configured ? DEEPSEEK_MODEL : null,
    }), { status: 200, headers: { "Content-Type": "application/json", ...cors(origin) } });
  }
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, message: "POST only" }), { status: 405, headers: cors(origin) });

  const user = await authUser(req);
  if (!user) return new Response(JSON.stringify({ ok: false, message: "Valid AWRIQ session required" }), { status: 401, headers: cors(origin) });

  const body = await req.json().catch(() => ({})) as RunRequest;
  if (!body.project_id) return new Response(JSON.stringify({ ok: false, message: "project_id required" }), { status: 400, headers: cors(origin) });

  return runOnce(body, user);
});