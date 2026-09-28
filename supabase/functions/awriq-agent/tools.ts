// awriq-agent / tools.ts — طبقة تنفيذ الأدوات (Backend Tool Runtime).
// تنفيذ حقيقي عبر GitHub API / GitHub Actions / Supabase (قراءة فقط آمنة).
// الأسرار (توكنات/مفاتيح) تُستخدم داخليًا فقط ولا تُرسل للمزوّد مطلقًا.

import type { ChatMessage } from "./providers.ts";

export interface AgentToolCtx {
  repo: { owner: string; repo: string; branch: string } | null;
  gitToken: string | null;
  vercelToken: string | null;
  vercelProjectId: string | null;
  supabase: any;
  serviceKey: string;
  mode: "read" | "plan" | "edit_approval" | "edit_auto";
  projectId: string | null;
  requestUserId: string | null;
}

export interface ToolEvent {
  fileChanged?: { path: string; action: string };
  approvalRequired?: { id: string; description: string; risk_level: string; files_affected: string[] };
  commandDispatched?: { workflow: string; run_url?: string; status: string };
}

export interface ToolResult {
  ok: boolean;
  output: string; // ما يُرسل للمزوّد (مقصوص ومُخيّى)
  events: ToolEvent[];
}

// ---------- إخفاء الأسرار ----------
const MASK_RE: Array<[string, RegExp]> = [
  ["deepseek", /\bsk-[A-Za-z0-9_-]{12,}\b/g],
  ["ghp", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ["vercel", /\b[a-zA-Z0-9]{24}\b(?=[\s"']*(?:$|[,}]))/g],
  ["enc", /\benc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+\b/g],
  ["aws", /\bAKIA[0-9A-Z]{16}\b/g],
  ["private-key", /-----[A-Z ]*PRIVATE KEY-----/g],
  ["bearer", /\bBearer\s+ey[A-Za-z0-9._-]{10,}\b/g],
];

function maskSecrets(text: string, ctx: AgentToolCtx): string {
  let out = text;
  for (const [, re] of MASK_RE) out = out.replace(re, "[secret]");
  if (ctx.gitToken) {
    try { out = out.split(ctx.gitToken).join("[github-token]"); } catch { /* ignore */ }
  }
  if (ctx.vercelToken) {
    try { out = out.split(ctx.vercelToken).join("[vercel-token]"); } catch { /* ignore */ }
  }
  if (ctx.serviceKey) {
    try { out = out.split(ctx.serviceKey).join("[supabase-service-key]"); } catch { /* ignore */ }
  }
  return out;
}

function truncate(s: string, n = 14000): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[مقصوصة — ${s.length - n} بايت]`;
}

// ---------- GitHub helpers ----------
const GH = "https://api.github.com";

async function ghJson(ctx: AgentToolCtx, url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "AWRIQ-Agent/1.0 (awriq-agent)",
      ...(ctx.gitToken ? { authorization: `Bearer ${ctx.gitToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 404) return null;
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new Error(`GitHub API HTTP ${res.status}: ${body?.message ?? body ?? "no body"}`);
  }
  return body;
}

async function ghRecursiveTree(ctx: AgentToolCtx): Promise<any[]> {
  if (!ctx.repo) return [];
  const tree = await ghJson(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/git/trees/${encodeURIComponent(ctx.repo.branch)}?recursive=1`);
  return Array.isArray(tree?.tree) ? tree.tree : [];
}

const BIN_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|woff2?|ttf|eot|map|min\.css|min\.js))$/i;

// ---------- أدوات ----------
const tp = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: props, required });

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "يسرد الملفات والمجلدات في المستودع الحالي (فعليًا من شجرة GitHub).",
      parameters: tp({ dir: { type: "string", description: "مجلد تعسفي" }, limit: { type: "number" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "يقرأ محتوى ملف فعليًا من المستودع (نص فقط؛ ملفات ثنائية تُرفض).",
      parameters: tp({ path: { type: "string" }, max_lines: { type: "number" } }, ["path"]),
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "يبحث نصيًا عن نمط (RegExp) داخل ملفات المستودع ويعيد المواضع (file:line).",
      parameters: tp({ pattern: { type: "string" }, dir: { type: "string" }, path: { type: "string" }, limit: { type: "number" } }, ["pattern"]),
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "يعدّل/يكتب ملفًا في المستودع محتوى كاملًا جديدًا، ثم يلتزمه Commit على الفرع. يتطلب GitHub credential.",
      parameters: tp({ path: { type: "string" }, new_content: { type: "string" }, commit_message: { type: "string" }, apply: { type: "string", enum: ["now", "ask"] } }, ["path", "new_content", "commit_message"]),
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "حالة المستودع الحقيقية: آخر الالتزامات والفرع (GitHub).",
      parameters: tp({ limit: { type: "number" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "فرق فعلي بين الفرعين/نقطتين في المستودع (GitHub compare).",
      parameters: tp({ base: { type: "string" }, head: { type: "string" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "ينفّذ أمرًا حقيقيًا (build/test/scripts) عبر GitHub Actions workflow_dispatch على مستودع. غير متاح إذا لا سير عمل أو توكن.",
      parameters: tp({ command: { type: "string" } }, ["command"]),
    },
  },
  {
    type: "function",
    function: {
      name: "supabase_select",
      description: "استعلام قراءة-only على جداول AWRIQ المسموح بها (خدمة الخادم) — لفحص بيانات المشروع/الجلسات.",
      parameters: tp({ table: { type: "string", enum: ["institutions", "sessions", "institution_admins", "projects", "project_integrations", "agent_runs", "agent_sessions", "user_profiles"] }, columns: { type: "string" }, limit: { type: "number" } }, ["table"]),
    },
  },
  {
    type: "function",
    function: {
      name: "vercel_list",
      description: "يسرد عمليات نشر Vercel الأخيرة للمشروع إذا وُجدت اعتمادات Vercel.",
      parameters: tp({ limit: { type: "number" } }),
    },
  },
];

function parseArgs(args: string): any {
  try { return JSON.parse(args || "{}"); } catch { return {}; }
}

export async function runTool(name: string, argsStr: string, ctx: AgentToolCtx): Promise<ToolResult> {
  const args = parseArgs(argsStr);
  try {
    switch (name) {
      case "list_files": return await execListFiles(args, ctx);
      case "read_file": return await execReadFile(args, ctx);
      case "search_files": return await execSearch(args, ctx);
      case "edit_file": return await execEditFile(args, ctx);
      case "git_status": return await execGitStatus(args, ctx);
      case "git_diff": return await execGitDiff(args, ctx);
      case "run_command": return await execRunCommand(args, ctx);
      case "supabase_select": return await execSupabaseSelect(args, ctx);
      case "vercel_list": return await execVercelList(args, ctx);
      default:
        return { ok: false, output: `أداة غير معروفة: ${name}`, events: [] };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, output: maskSecrets(truncate(msg), ctx), events: [] };
  }
}

const noRepo = () => ({ ok: false, output: "لا مستودع GitHub مرتبط بهذا المشروع في السياق.", events: [] });
const noToken = () => ({
  ok: false,
  output: "لا يوجد GitHub credential لهذا المشروع في خزنة AWRIQ (project_credentials). أضِف التوكن من تبويب Git ثم أعد المحاولة.",
  events: [],
});

async function execListFiles(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  const tree = await ghRecursiveTree(ctx);
  const limit = Math.min(Math.max(args?.limit ?? 300, 1), 800);
  let rows = tree.filter((t: any) => t.type === "blob").map((t: any) => t.path);
  const dir = String(args?.dir ?? "").replace(/\/+$/, "");
  if (dir) rows = rows.filter((p: string) => p.startsWith(dir + "/") || p === dir);
  rows = rows.slice(0, limit);
  const dirs = [...new Set(rows.map((p: string) => p.includes("/") ? p.split("/")[0] : "").filter(Boolean))];
  const out = [`إجمالي الملفات المدرجة (حد: ${limit}): ${rows.length}`, dir ? `مجلد: ${dir}` : "الجذر", `أفرع رئيسة: ${dirs.join("، ") || "—"}`, "", ...rows.map((p: string) => `  ${p}`)].join("\n");
  return { ok: true, output: maskSecrets(truncate(out), ctx), events: [] };
}

async function execReadFile(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const path = String(args?.path ?? "").trim().replace(/^\/+/, "");
  if (!path) return { ok: false, output: "path مطلوب", events: [] };
  const data = await ghJson(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ctx.repo.branch)}`);
  if (!data || typeof data.content !== "string") return { ok: false, output: `الملف غير موجود أو ثنائي: ${path}`, events: [] };
  let content = atob(data.content);
  if (BIN_RE.test(path) && /\x00/.test(content)) {
    return { ok: false, output: `ملف ثنائي/كبير (أُرفضت القراءة كنص): ${path}`, events: [] };
  }
  if (content.length > 200000) content = `${content.slice(0, 200000)}\n…[حجم كبير — قُصّت]`;
  const maxLines = Math.min(Math.max(args?.max_lines ?? 2000, 1), 10000);
  const lines = content.split("\n");
  if (lines.length > maxLines) content = `${lines.slice(0, maxLines).join("\n")}\n…[${lines.length - maxLines} سطرًا لاحقة]`;
  return { ok: true, output: maskSecrets(truncate(`## ${path} (أحرف ${content.length})\n${content}`, 30000), ctx), events: [] };
}

async function execSearch(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const pattern = String(args?.pattern ?? "");
  if (!pattern) return { ok: false, output: "pattern مطلوب", events: [] };
  let re: RegExp;
  try { re = new RegExp(pattern, "i"); } catch {
    return { ok: false, output: "نقّاط RegExp غير صالحة", events: [] };
  }
  const tree = await ghRecursiveTree(ctx);
  const dir = String(args?.dir ?? "").replace(/\/+$/, "");
  const ll = String(args?.path ?? "").trim().replace(/^\/+/, "");
  const limit = Math.min(Math.max(args?.limit ?? 40, 1), 200);
  const files = tree
    .filter((t: any) => t.type === "blob" && !BIN_RE.test(t.path))
    .map((t: any) => t.path)
    .filter((p: string) => (dir ? p.startsWith(dir + "/") : true) && (ll ? p.endsWith(ll) : true))
    .slice(0, 400);
  const hits: string[] = [];
  let scanned = 0;
  for (const p of files) {
    if (hits.length >= limit) break;
    try {
      const data = await ghJson(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ctx.repo.branch)}`);
      if (!data || typeof data.content !== "string") continue;
      scanned++;
      let content = atob(data.content);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && hits.length < limit; i++) {
        if (!re.test(lines[i])) continue;
        re.lastIndex = 0;
        hits.push(`سطر ${i + 1} ${p}: ${lines[i].trim().slice(0, 220)}`);
      }
    } catch { /* skip */ }
  }
  if (!hits.length) return { ok: true, output: `لا تطابقات لـ/${pattern}/i ضمن ${scanned} ملفًا مفحوصًا.`, events: [] };
  return { ok: true, output: maskSecrets(truncate(`تطابقات /${pattern}/i (ملفات فحصت: ${scanned})\n${hits.join("\n")}`, 20000), ctx), events: [] };
}

async function execEditFile(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const path = String(args?.path ?? "").trim().replace(/^\/+/, "");
  const content = String(args?.new_content ?? "");
  const msg = String(args?.commit_message ?? `AWRIQ Agent: تعديل ${path}`).slice(0, 200);
  if (!path || !content) return { ok: false, output: "path و new_content مطلوبان", events: [] };

  const applyNow = ctx.mode === "edit_auto" || String(args?.apply ?? "").toLowerCase() === "now";
  const actionDescr = `تعديل ${path} («${msg}»)`;

  if (!applyNow && ctx.mode === "edit_approval") {
    const { data, error } = await ctx.supabase
      .from("agent_approvals")
      .insert({
        project_id: ctx.projectId,
        user_id: ctx.requestUserId,
        action_type: "file_modify",
        description: msg,
        risk_level: "medium",
        files_affected: [path],
        status: "pending",
        payload: { path, new_content: content, commit_message: msg },
      })
      .select("id")
      .single();
    if (error || !data?.id) return { ok: false, output: "فشل حفظ طلب الموافقة: " + (error?.message ?? "؟"), events: [] };
    return {
      ok: true,
      output: `طُلب تعديل ${path} لكنه بحاجة موافقة. أُرسل طلب الموافقة رقم ${data.id} إلى المستخدم. انتظر الموافقة قبل المتابعة. لا تعدّل الملف بعد.`,
      events: [{ approvalRequired: { id: String(data.id), description: actionDescr, risk_level: "medium", files_affected: [path] } }],
    };
  }

  const from = path.split("/");
  const enc = from.map(encodeURIComponent).join("/");
  const existing = await ghJson(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${enc}?ref=${encodeURIComponent(ctx.repo.branch)}`);
  const sha = existing?.sha ?? null;
  const commit = await ghJson(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${enc}`, {
    method: "PUT",
    body: JSON.stringify({
      message: msg,
      content: btoa(content),
      sha: sha ?? undefined,
      branch: ctx.repo.branch,
    }),
  });
  if (!commit?.content?.sha) return { ok: false, output: `فشل التزام التعديل على ${path} (استجابة GitHub غير متوقعة).`, events: [] };
  return {
    ok: true,
    output: `التزم التعديل بنجاح على ${path} (فرع ${ctx.repo.branch}) — commit "«${msg}»" sha ${commit.commit.sha?.slice?.(0, 7) ?? "؟"}.`,
    events: [{ fileChanged: { path, action: "committed" } }],
  };
}

async function execGitStatus(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const limit = Math.min(Math.max(args?.limit ?? 5, 1), 20);
  const commits = await ghJson(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/commits?sha=${encodeURIComponent(ctx.repo.branch)}&per_page=${limit}`);
  if (!Array.isArray(commits)) return { ok: false, output: "تعطلت قراءة الالتزامات.", events: [] };
  const rows = commits.map((c: any) => `- ${c.sha.slice(0, 7)} ${c.commit?.message?.split("\n")[0].slice(0, 72)} (${c.commit?.author?.name ?? "?"}, ${c.commit?.author?.date ?? "?"})`);
  const out = [`الفرع: ${ctx.repo.branch}`, "أحدث الالتزامات:", ...rows].join("\n");
  return { ok: true, output: maskSecrets(truncate(out), ctx), events: [] };
}

async function execGitDiff(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const head = String(args?.head ?? ctx.repo.branch);
  const commits = await ghJson(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/commits?sha=${encodeURIComponent(head)}&per_page=1`);
  const latest = Array.isArray(commits) ? commits[0]?.sha : null;
  const base = String(args?.base ?? (latest ? `${latest}~1` : ""));
  if (!base) return { ok: false, output: "لا يمكن اشتقاق نقطة المقارنة.", events: [] };
  const c = await ghJson(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  if (!c) return { ok: false, output: "فشل حساب الفرق.", events: [] };
  const files = (c.files ?? []).map((f: any) => `- ${f.status} ${f.filename} (+${f.additions}/-${f.deletions})${f.patch ? `\n${f.patch.slice(0, 4000)}` : ""}`).slice(0, 30);
  const out = [`الفرق ${base.slice(0, 10)}...${head} — ${c.total_commits} commit، +${c.ahead_by}/-${c.behind_by}`, ...files, files.length ? "" : "(لا تغييرات)"].join("\n");
  return { ok: true, output: maskSecrets(truncate(out, 30000), ctx), events: [] };
}

async function execRunCommand(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const command = String(args?.command ?? "").trim();
  if (!command) return { ok: false, output: "command مطلوب", events: [] };
  const tree = await ghRecursiveTree(ctx);
  const wfs = tree.filter((t: any) => t.type === "blob" && t.path.startsWith(".github/workflows/") && t.path.endsWith(".yml"));
  if (!wfs.length) {
    return {
      ok: false,
      output: `run_command غير متاح: لا يوجد سير عمل في .github/workflows/ في ${ctx.repo.owner}/${ctx.repo.repo}. أضِف awriq-run.yml بأوامر build/test، أو نفّذه محليًا. لن أنسب لك أي أمر "تم".`,
      events: [],
    };
  }
  const wf = wfs[0].path.replace(/^\.github\/workflows\//, "");
  const url = `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/actions/workflows/${encodeURIComponent(wf)}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${ctx.gitToken}`,
      "user-agent": "AWRIQ-Agent/1.0 (awriq-agent)",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: ctx.repo.branch === "HEAD" ? "main" : ctx.repo.branch, inputs: { command } }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); msg = b?.message || msg; } catch { /* */ }
    return { ok: false, output: `فشل إطلاق الأمر عبر Actions: ${msg}`, events: [] };
  }
  let run: any = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const runs = await ghJson(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/actions/workflows/${encodeURIComponent(wf)}/runs?per_page=1`);
    const r0 = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs[0] : null;
    if (!r0) continue;
    run = r0;
    if (r0.status === "completed" || run?.conclusion) break;
  }
  if (!run) {
    return { ok: false, output: `أُطلق الأمر عبر Actions لكن تعذر رصد الجري في المهلة (انظر تبويب Actions).`, events: [{ commandDispatched: { workflow: wf, status: "dispatched" } }] };
  }
  const concluded = run.conclusion ?? run.status;
  const line = `الأمر "${command}" (workflow ${wf}): status=${run.status} conclusion=${concluded} exit=0@${run.head_sha?.slice?.(0,7) ?? "?"}\n${run.html_url ?? ""}`;
  return {
    ok: concluded === "success",
    output: run.conclusion === "success"
      ? `نفّذ GitHub Actions الأمر "${command}" بنجاح (conclusion=success). ${run.html_url ?? ""}`
      : `فشل تنفيذ الأمر "${command}" عبر Actions (conclusion=${concluded}). ${run.html_url ?? ""} — لا أعتبر المشكلة منتهية حتى ينجح.`,
    events: [{ commandDispatched: { workflow: wf, run_url: run.html_url ?? undefined, status: String(concluded) } }],
  };
}

const SUPABASE_SELECT_ALLOWLIST = ["institutions", "sessions", "institution_admins", "projects", "project_integrations", "agent_runs", "agent_sessions", "user_profiles"];

async function execSupabaseSelect(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  const table = String(args?.table ?? "").trim();
  if (!SUPABASE_SELECT_ALLOWLIST.includes(table)) {
    return { ok: false, output: `supabase_select يسمح فقط بـ: ${SUPABASE_SELECT_ALLOWLIST.join(", ")}`, events: [] };
  }
  const columns = String(args?.columns ?? "*").trim();
  const limit = Math.min(Math.max(args?.limit ?? 20, 1), 100);
  const url = `${Deno.env.get("SUPABASE_URL") ?? ""}/rest/v1/${table}?select=${encodeURIComponent(columns)}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { apikey: ctx.serviceKey, authorization: `Bearer ${ctx.serviceKey}` },
  });
  if (!res.ok) return { ok: false, output: `تعذر قراءة ${table} (${res.status}).`, events: [] };
  const rows = await res.json();
  const out = JSON.stringify(rows, null, 1).slice(0, 16000);
  return { ok: true, output: maskSecrets(truncate(out), ctx), events: [] };
}

async function execVercelList(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.vercelToken) return { ok: false, output: "لا اعتماد Vercel لهذا المشروع في خزنة AWRIQ.", events: [] };
  const limit = Math.min(Math.max(args?.limit ?? 5, 1), 20);
  const qs = ctx.vercelProjectId ? `?projectId=${encodeURIComponent(ctx.vercelProjectId)}` : "";
  const res = await fetch(`https://api.vercel.com/v6/deployments${qs}&limit=${limit}`, {
    headers: { authorization: `Bearer ${ctx.vercelToken}` },
  });
  if (!res.ok) return { ok: false, output: `فشل قراءة نشرات Vercel (${res.status}).`, events: [] };
  const data = await res.json();
  const rows = (data.deployments ?? []).map((d: any) => `- ${d.state} ${d.url} (${d.created})`);
  return { ok: true, output: maskSecrets(rows.join("\n") || "لا نشرات.", ctx), events: [] };
}