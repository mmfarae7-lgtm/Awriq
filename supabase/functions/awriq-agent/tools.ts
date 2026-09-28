// awriq-agent / tools.ts — طبقة تنفيذ الأدوات (Backend Tool Runtime) v2.
// أدوات موجهة: بيانات DB أول، بحث مستهدف، ميزانيات، أخطاء حقيقية بتصنيف.
// الأسرار (توكنات/مفاتيح) تُستخدم داخليًا فقط ولا تُرسل للمزوّد مطلقًا.

export type AgentMode = "read" | "plan" | "edit_approval" | "edit_auto";

export interface AgentToolCtx {
  repo: { owner: string; repo: string; branch: string } | null;
  gitToken: string | null;
  vercelToken: string | null;
  vercelProjectId: string | null;
  supabase: any;
  serviceKey: string;
  mode: AgentMode;
  projectId: string | null;
  requestUserId: string | null;
  cache: { tree: { at: number; items: any[] } | null };
}

export interface ToolEvent {
  fileChanged?: { path: string; action: string };
  approvalRequired?: { id: string; description: string; risk_level: string; files_affected: string[]; table?: string };
  commandDispatched?: { workflow: string; run_url?: string; status: string };
}

export type ToolErrorType = "auth" | "not_found" | "limit" | "transient" | "invalid" | "unknown";

export interface ToolResult {
  ok: boolean;
  output: string; // ما يُرسل للمزوّد (مقصوص ومُخيّى)
  events: ToolEvent[];
  errorType?: ToolErrorType;
  statusCode?: number;
  durationMs?: number;
  retried?: boolean;
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
  if (ctx.gitToken) { try { out = out.split(ctx.gitToken).join("[github-token]"); } catch { /* ignore */ } }
  if (ctx.vercelToken) { try { out = out.split(ctx.vercelToken).join("[vercel-token]"); } catch { /* ignore */ } }
  if (ctx.serviceKey) { try { out = out.split(ctx.serviceKey).join("[supabase-service-key]"); } catch { /* ignore */ } }
  return out;
}

function truncate(s: string, n = 14000): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[مقصوصة — ${s.length - n} بايت]`;
}

// ---------- fetch مع مهلة + تصنيف أخطاء ----------
interface NetResult { ok: boolean; status: number; body: any; transient: boolean; }
const TIMEOUT_MS = 15000;

async function netJson(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<NetResult> {
  const timeoutMs = init?.timeoutMs ?? TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const transient = res.status >= 500 || res.status === 429;
    return { ok: res.ok, status: res.status, body, transient };
  } catch (e: any) {
    const transient = e?.name === "AbortError" || e?.name === "TypeError";
    return { ok: false, status: 0, body: transient ? `مهلة/شبكة بعد ${timeoutMs}ms` : String(e?.message ?? e), transient };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- GitHub helpers ----------
const GH = "https://api.github.com";

async function ghTree(ctx: AgentToolCtx): Promise<any[]> {
  if (!ctx.repo) return [];
  const cached = ctx.cache.tree;
  if (cached && Date.now() - cached.at < 90000) return cached.items;
  const r = await netJson(`${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/git/trees/${encodeURIComponent(ctx.repo.branch)}?recursive=1`);
  if (!r.ok) return cached?.items ?? [];
  ctx.cache.tree = { at: Date.now(), items: Array.isArray(r.body?.tree) ? r.body.tree : [] };
  return ctx.cache.tree.items;
}

async function ghRequest(ctx: AgentToolCtx, url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any; transient: boolean }> {
  return netJson(url, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "AWRIQ-Agent/1.0 (awriq-agent)",
      ...(ctx.gitToken ? { authorization: `Bearer ${ctx.gitToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

const BIN_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|woff2?|ttf|eot|map|min\.css|min\.js))$/i;

function pickRoots(treeItems: any[]): string[] {
  const tops = new Set<string>();
  for (const t of treeItems) {
    if (t.type !== "blob") continue;
    const p = String(t.path ?? "");
    const first = p.split("/")[0];
    if (first) tops.add(first);
  }
  const codeRoots = ["src", "app", "lib", "pages", "api", "classes", "includes", "components", "routes", "config"];
  const present = codeRoots.filter((r) => tops.has(r));
  return present.length ? present : ([""] as string[]); // empty = جذر كامل (qصر مع deadline/cap)
}

function hasRegExpMeta(pattern: string): boolean {
  return /[\\^$.*+?()[\]{}|]/.test(pattern);
}

// ---------- أدوات ----------
const tp = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: props, required });

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "يسرد ملفات مجلد محدد في المستودع فقط (لا تسرد الجذر/كل المشروع). استخدمه لأسئلة البنية. للبيانات (مدرسة/جلسة) استخدم db_select.",
      parameters: tp({ dir: { type: "string", description: "مجلد محدد مثل src/ أو src/pages (مطلوب)" }, limit: { type: "number" } }, ["dir"]),
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "يقرأ محتوى ملف محدد من المستودع (نص فقط؛ ثنائي يُرفض).",
      parameters: tp({ path: { type: "string" }, max_lines: { type: "number" } }, ["path"]),
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "بحث نصي مستهدف داخل مجلد محدد (dir أو path مطلوبان إن أمكن) — لا تبحث في كل المشروع. يُرجع file:line. لا تستخدمه للبيانات (مدرسة/طالب) — استخدم db_select.",
      parameters: tp({ pattern: { type: "string" }, dir: { type: "string", description: "مجلد محدد للبحث (يفضل)" }, path: { type: "string", description: "اسم ملف محدد" }, limit: { type: "number" } }, ["pattern"]),
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "يعدّل/يكتب ملفًا محددًا في المستودع ثم يلتزمه Commit. بحاجة موافقة (apply=ask) في وضع الإصلاح. يتطلب GitHub credential.",
      parameters: tp({ path: { type: "string" }, new_content: { type: "string" }, commit_message: { type: "string" }, apply: { type: "string", enum: ["now", "ask"] } }, ["path", "new_content", "commit_message"]),
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "حالة المستودع الحقيقية: الفرع وأحدث الالتزامات.",
      parameters: tp({ limit: { type: "number" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "فرق فعلي بين نقطتين/فرعين في المستودع.",
      parameters: tp({ base: { type: "string" }, head: { type: "string" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "ينفّذ أمرًا (build/test) عبر GitHub Actions workflow_dispatch. لا ينفّذ shell مباشرة. غير متاح إذا لا سير عمل.",
      parameters: tp({ command: { type: "string" } }, ["command"]),
    },
  },
  {
    type: "function",
    function: {
      name: "db_select",
      description: "استعلام قراءة على قاعدة بيانات AWRIQ (خدمة الخادم). مصدر الحقيقة للبيانات: المدارس=institutions، الجلسات=sessions، المشاريع=projects. استخدمه مباشرة لأي طلب بيانات دون مسح ملفات.",
      parameters: tp({
        table: { type: "string", enum: ["institutions", "sessions", "institution_admins", "projects", "project_integrations", "project_members", "user_profiles", "organizations", "roles", "agent_runs", "agent_sessions", "activity_logs", "deployment_records"] },
        columns: { type: "string", description: "أعمدة مفصولة بفاصلة (اختياري، افتراضي *)" },
        where: { type: "array", items: { type: "array", items: [{ type: "string" }, { type: "string" }] }, description: "مطابقة دقيقة: [['column','value']]" },
        like: { type: "array", items: { type: "array", items: [{ type: "string" }, { type: "string" }] }, description: "مطابقة جزئية (ilike): [['name_ar','الأمل']]" },
        order: { type: "string" }, order_dir: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number" }, page: { type: "number" },
      }, ["table"]),
    },
  },
  {
    type: "function",
    function: {
      name: "db_delete",
      description: "حذف سجل (عملية حساسة) — يتطلب موافقة المستخدم دائمًا. يعرض السجل المطابق أولاً ثم يطلب الموافقة للحذف الفعلي.",
      parameters: tp({ table: { type: "string", enum: ["institutions", "sessions", "institution_admins"] }, id: { type: "string" }, reason: { type: "string" } }, ["table", "id", "reason"]),
    },
  },
  {
    type: "function",
    function: {
      name: "vercel_list",
      description: "يسرد نشرات Vercel الأخيرة للمشروع إذا وُجد اعتماد Vercel.",
      parameters: tp({ limit: { type: "number" } }),
    },
  },
];

const READ_TABLES = ["institutions", "sessions", "institution_admins", "projects", "project_integrations", "project_members", "user_profiles", "organizations", "roles", "agent_runs", "agent_sessions", "activity_logs", "deployment_records"];
const DELETE_TABLES = ["institutions", "sessions", "institution_admins"];
const KNOWN_COLUMNS: Record<string, string[]> = {
  institutions: ["id", "institution_id", "tenant_id", "system_id", "name", "name_ar", "type", "system_name", "domain", "logo_url", "image_url", "governorate", "city", "address", "contact_email", "contact_phone", "notes", "status", "is_favorite", "student_count", "teacher_count", "last_heartbeat_at", "last_sync_at", "system_version", "connection_status", "created_at", "updated_at"],
  sessions: ["id", "user_id", "session_token", "ip_address", "user_agent", "is_active", "expires_at", "last_activity_at", "created_at"],
  institution_admins: ["id", "institution_id", "name", "email", "phone", "role", "is_primary", "created_at", "updated_at"],
  projects: ["id", "institution_id", "name", "description", "repository_url", "environment", "root_path", "agent_status", "github_repo", "github_branch", "vercel_project", "supabase_project", "project_type", "status", "is_active", "last_agent_run_at", "last_deployment_at", "organization_id", "slug", "created_at", "updated_at", "agent_profile"],
  project_integrations: ["id", "project_id", "kind", "provider_ref", "scopes", "auth_method", "token_enc", "is_connected", "health", "last_checked_at", "created_at", "updated_at"],
  project_members: ["project_id", "user_id", "role", "created_at"],
  user_profiles: ["id", "user_id", "full_name", "full_name_ar", "avatar_url", "phone", "is_active", "last_login_at", "created_at", "updated_at"],
  organizations: ["id", "name", "name_ar", "description", "owner_user_id", "is_active", "created_at", "updated_at"],
  roles: ["id", "name", "name_ar", "description", "is_system_role", "created_at", "updated_at"],
  agent_runs: ["id", "session_id", "task_id", "project_id", "user_id", "started_at", "ended_at", "status", "actions", "commands", "files_changed", "tests_run", "tests_passed", "result", "error", "created_at", "usage_info"],
  agent_sessions: ["id", "user_id", "institution_id", "project_id", "token_id", "mode", "status", "permissions", "started_at", "ended_at", "created_at", "lifecycle", "agent_client", "last_activity_at"],
  activity_logs: ["id", "user_id", "action", "resource", "resource_id", "institution_id", "details", "metadata", "created_at"],
  deployment_records: ["id", "project_id", "institution_id", "run_id", "version", "status", "environment", "health_check_passed", "deployed_at", "provider", "external_url", "session_id", "approval_id", "message", "created_at"],
};
const COL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseArgs(args: string): any {
  try { return JSON.parse(args || "{}"); } catch { return {}; }
}

function rowLabel(row: any): string {
  return String(row?.name_ar || row?.name || row?.title || row?.slug || (row?.id ?? "سجل"));
}

export async function runTool(name: string, argsStr: string, ctx: AgentToolCtx): Promise<ToolResult> {
  const started = Date.now();
  const args = parseArgs(argsStr);
  const errorTypeOf = (r: any, status: number, transient: boolean): ToolErrorType =>
    transient ? "transient" : status === 401 || status === 403 ? "auth" : status === 404 ? "not_found" : status === 429 ? "limit" : status >= 400 && r?.ok === false ? "invalid" : "unknown";

  const exec = (): Promise<ToolResult> => {
    switch (name) {
      case "list_files": return execListFiles(args, ctx);
      case "read_file": return execReadFile(args, ctx);
      case "search_files": return execSearch(args, ctx);
      case "edit_file": return execEditFile(args, ctx);
      case "git_status": return execGitStatus(args, ctx);
      case "git_diff": return execGitDiff(args, ctx);
      case "run_command": return execRunCommand(args, ctx);
      case "db_select":
      case "supabase_select": return execDbSelect(args, ctx);
      case "db_delete": return execDbDelete(args, ctx);
      case "vercel_list": return execVercelList(args, ctx);
      default: return Promise.resolve({ ok: false, output: `أداة غير معروفة: ${name}`, events: [], errorType: "invalid" });
    }
  };

  try {
    const r = await exec();
    r.durationMs = Date.now() - started;
    return r;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const transient = /(timeout|Timed out|майor 502|network|fetch failed|could not connect)/i.test(msg);
    const r: ToolResult = { ok: false, output: maskSecrets(truncate(msg), ctx), events: [], errorType: transient ? "transient" : "unknown", durationMs: Date.now() - started };
    // Retry مرة واحدة فقط للأخطاء العابرة (مهلة/شبكة/5xx)
    if (transient) {
      try { return { ...(await exec()), retried: true, durationMs: Date.now() - started }; } catch { /* ignore */ }
    }
    return r;
  }
}

const noRepo = () => ({ ok: false, output: "لا مستودع GitHub مرتبط بهذا المشروع في السياق.", events: [], errorType: "invalid" as const });
const noToken = () => ({
  ok: false,
  output: "لا يوجد GitHub credential لهذا المشروع في خزنة AWRIQ (project_credentials). أضِفه من تبويب الوصول ثم أعد المحاولة.",
  events: [],
  errorType: "auth" as const,
});

// ---------- File tools ----------
async function execListFiles(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  const tree = await ghTree(ctx);
  const dir = String(args?.dir ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!dir) {
    return { ok: false, output: "list_files يحتاج dir محددًا (مثل src/ أو src/pages) — لا تسرد المشروع كاملًا. اسأل عن بنية مجلد محدد، أو استخدم db_select للبيانات.", events: [], errorType: "invalid" };
  }
  const limit = Math.min(Math.max(args?.limit ?? 80, 1), 300);
  const rows = tree.filter((t: any) => t.type === "blob" && (t.path.startsWith(dir + "/") || t.path === dir)).map((t: any) => t.path).slice(0, limit);
  const subdirs = [...new Set(rows.map((p: string) => p.slice(dir.length + 1).split("/")[0]).filter(Boolean))];
  const out = [`مجلد: ${dir} (حد: ${limit}) — ${rows.length} ملف`, ...(subdirs.length ? [`أفرع فرعية: ${subdirs.join(", ")}`] : []), "", ...rows.map((p: string) => `  ${p}`)].join("\n");
  return { ok: true, output: maskSecrets(truncate(out), ctx), events: [] };
}

async function execReadFile(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const path = String(args?.path ?? "").trim().replace(/^\/+/, "");
  if (!path) return { ok: false, output: "path مطلوب", events: [], errorType: "invalid" };
  const r = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ctx.repo.branch)}`);
  if (r.status === 404) return { ok: false, output: `الملف غير موجود: ${path}`, events: [], errorType: "not_found", statusCode: 404 };
  if (!r.ok) return { ok: false, output: `فشل قراءة ${path} (HTTP ${r.status}).`, events: [], errorType: "auth", statusCode: r.status };
  const data = r.body;
  if (typeof data?.content !== "string") return { ok: false, output: `الملف ثنائي أو غير قابل للقراءة: ${path}`, events: [], errorType: "unknown" };
  let content = atob(data.content);
  if (BIN_RE.test(path) && /\x00/.test(content)) return { ok: false, output: `ملف ثنائي (أُرفض كقراءة نص): ${path}`, events: [] };
  if (content.length > 200000) content = `${content.slice(0, 200000)}\n…[كبير — قُصّت]`;
  const maxLines = Math.min(Math.max(args?.max_lines ?? 2000, 1), 10000);
  const lines = content.split("\n");
  if (lines.length > maxLines) content = `${lines.slice(0, maxLines).join("\n")}\n…[${lines.length - maxLines} سطرًا لاحقة]`;
  return { ok: true, output: maskSecrets(truncate(`## ${path} (أحرف ${content.length})\n${content}`, 30000), ctx), events: [] };
}

async function execSearch(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const repo = ctx.repo; // narrows إلى closure
  const pattern = String(args?.pattern ?? "").trim();
  if (!pattern) return { ok: false, output: "pattern مطلوب", events: [], errorType: "invalid" };
  const dir = String(args?.dir ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const ll = String(args?.path ?? "").trim().replace(/^\/+/, "");
  const limit = Math.min(Math.max(args?.limit ?? 20, 1), 60);

  const fallback = async (reason: string): Promise<ToolResult> => {
    const tree = await ghTree(ctx);
    const roots = dir ? [dir] : pickRoots(tree);
    const before = Date.now();
    const deadline = before + 9000;
    const files = tree
      .filter((t: any) => t.type === "blob" && !BIN_RE.test(t.path))
      .map((t: any) => t.path)
      .filter((p: string) => roots.some((r) => (r ? p.startsWith(r + "/") || p === r : true)) && (ll ? p.endsWith(ll) : true))
      .slice(0, 150);
    const hits: string[] = [];
    let scanned = 0;
    for (const p of files) {
      if (hits.length >= limit || Date.now() > deadline) break;
      const r = await ghRequest(ctx, `${GH}/repos/${repo.owner}/${repo.repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(repo.branch)}`);
      if (r.status === 404) continue;
      if (typeof r.body?.content !== "string") continue;
      scanned++;
      let content = atob(r.body.content);
      let re: RegExp;
      try { re = new RegExp(pattern, "i"); } catch { return { ok: false, output: "Regex غير صالحة", events: [], errorType: "invalid" }; }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && hits.length < limit; i++) {
        re.lastIndex = 0;
        if (!re.test(lines[i])) continue;
        hits.push(`سطر ${i + 1} ${p}: ${lines[i].trim().slice(0, 220)}`);
      }
    }
    const timedOut = Date.now() > deadline;
    if (!hits.length) return { ok: true, output: `لا تطابقات لـ/${pattern}/i ضمن ${scanned} ملفًا (مجلدات: ${roots.join(", ") || "الجذر"}).${timedOut ? " توقفت المهلة قبل اكتمال المسح." : ""}`, events: [] };
    return { ok: true, output: maskSecrets(truncate(`تطابقات /${pattern}/i (فحص ${scanned} ملفًا)${timedOut ? " [وقف المهلة — ضيّق dir/path]" : ""}\n${hits.join("\n")}`, 20000), ctx), events: [] };
  };

  // مسار سريع: كلمة بحث بدون regex meta → GitHub Code Search (فهرس جاهز، لا يمسح ملفات)
  if (!hasRegExpMeta(pattern) && !ll) {
    const q = `${pattern} repo:${repo.owner}/${repo.repo}${dir ? ` path:/${dir}/` : ""}`;
    const r = await ghRequest(ctx, `${GH}/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`);
    if (r.ok && Array.isArray(r.body?.items)) {
      const paths = r.body.items.map((it: any) => it.path as string);
      if (paths.length === 0) return { ok: true, output: `لا نتائج لكلمة "${pattern}" (GitHub code search).`, events: [] };
      const hits: string[] = [];
      let scanned = 0;
      for (const p of paths) {
        const rr = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ctx.repo.branch)}`);
        if (typeof rr.body?.content !== "string") continue;
        scanned++;
        const lineIdx = atob(rr.body.content).split("\n").map((l: string) => l.toLowerCase()).findIndex((l: string) => l.includes(pattern.toLowerCase()));
        hits.push(`سطر ${lineIdx + 1} ${p}: ${atob(rr.body.content).split("\n")[Math.max(lineIdx, 0)]?.trim().slice(0, 220)}`);
      }
      return { ok: true, output: maskSecrets(truncate(`Code Search "${pattern}" → ${hits.length} تطابق\n${hits.join("\n")}`, 20000), ctx), events: [] };
    }
    // لا توجد خدمات code search (repo خاص أو حد) → نطاق محدود بالجذر
  }
  return fallback("code search غير متاح/غير دقيق");
}

// ---------- Edit/Commit ----------
async function execEditFile(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const path = String(args?.path ?? "").trim().replace(/^\/+/, "");
  const content = String(args?.new_content ?? "");
  const msg = String(args?.commit_message ?? `AWRIQ Agent: تعديل ${path}`).slice(0, 200);
  if (!path || !content) return { ok: false, output: "path و new_content مطلوبان", events: [], errorType: "invalid" };
  const applyNow = ctx.mode === "edit_auto" || String(args?.apply ?? "").toLowerCase() === "now";
  const actionDescr = `تعديل ${path} («${msg}»)`;
  if (!applyNow && ctx.mode === "edit_approval") {
    const { data, error } = await ctx.supabase
      .from("agent_approvals")
      .insert({ project_id: ctx.projectId, user_id: ctx.requestUserId, action_type: "file_modify", description: msg, risk_level: "medium", files_affected: [path], status: "pending", payload: { path, new_content: content, commit_message: msg } })
      .select("id").single();
    if (error || !data?.id) return { ok: false, output: "فشل حفظ طلب الموافقة: " + (error?.message ?? "؟"), events: [], errorType: "unknown" };
    return { ok: true, output: `طُلب تعديل ${path} وهو بانتظار الموافقة (#${data.id}). توقف وانتظر الموافقة.`, events: [{ approvalRequired: { id: String(data.id), description: actionDescr, risk_level: "medium", files_affected: [path] } }] };
  }
  const enc = path.split("/").map(encodeURIComponent).join("/");
  const existing = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${enc}?ref=${encodeURIComponent(ctx.repo.branch)}`);
  const sha = existing.ok && existing.body?.sha ? existing.body.sha : null;
  const commit = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${enc}`, {
    method: "PUT",
    body: JSON.stringify({ message: msg, content: btoa(content), sha: sha ?? undefined, branch: ctx.repo.branch }),
  });
  if (!commit.ok || !commit.body?.content?.sha) return { ok: false, output: `فشل التزام التعديل على ${path} (HTTP ${commit.status}) — لم يُطبق.`, events: [], errorType: "unknown", statusCode: commit.status };
  return { ok: true, output: `التزم التعديل بنجاح على ${path} (فرع ${ctx.repo.branch}) — commit «${msg}» sha ${commit.body.commit?.sha?.slice?.(0, 7) ?? "؟"}.`, events: [{ fileChanged: { path, action: "committed" } }] };
}

// ---------- Git ----------
async function execGitStatus(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const limit = Math.min(Math.max(args?.limit ?? 5, 1), 20);
  const r = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/commits?sha=${encodeURIComponent(ctx.repo.branch)}&per_page=${limit}`);
  if (!Array.isArray(r.body)) return { ok: false, output: `فشل قراءة الالتزامات (HTTP ${r.status}).`, events: [], errorType: "unknown", statusCode: r.status };
  const rows = r.body.map((c: any) => `- ${c.sha.slice(0, 7)} ${c.commit?.message?.split("\n")[0].slice(0, 72)} (${c.commit?.author?.name ?? "?"}, ${c.commit?.author?.date ?? "?"})`);
  return { ok: true, output: maskSecrets(truncate([`الفرع: ${ctx.repo.branch}`, "أحدث الالتزامات:", ...rows].join("\n")), ctx), events: [] };
}

async function execGitDiff(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const head = String(args?.head ?? ctx.repo.branch);
  const r0 = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/commits?sha=${encodeURIComponent(head)}&per_page=1`);
  const latest = Array.isArray(r0.body) ? r0.body[0]?.sha : null;
  const base = String(args?.base ?? (latest ? `${latest}~1` : ""));
  if (!base) return { ok: false, output: "لا يمكن اشتقاق نقطة المقارنة.", events: [], errorType: "invalid" };
  const r = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  if (!r.ok || !r.body) return { ok: false, output: `فشل حساب الفرق (HTTP ${r.status}).`, events: [], errorType: "unknown", statusCode: r.status };
  const files = (r.body.files ?? []).map((f: any) => `- ${f.status} ${f.filename} (+${f.additions}/-${f.deletions})${f.patch ? `\n${f.patch.slice(0, 4000)}` : ""}`).slice(0, 30);
  return { ok: true, output: maskSecrets(truncate([`الفرق ${base.slice(0, 10)}...${head} — ${r.body.total_commits} commit، +${r.body.ahead_by}/-${r.body.behind_by}`, ...files, files.length ? "" : "(لا تغييرات)"].join("\n"), 30000), ctx), events: [] };
}

// ---------- run_command (GitHub Actions) ----------
async function execRunCommand(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const command = String(args?.command ?? "").trim();
  if (!command) return { ok: false, output: "command مطلوب", events: [], errorType: "invalid" };
  const tree = await ghTree(ctx);
  const wfs = tree.filter((t: any) => t.type === "blob" && t.path.startsWith(".github/workflows/") && t.path.endsWith(".yml"));
  if (!wfs.length) return { ok: false, output: `run_command غير متاح: لا سير عمل في .github/workflows/ — أضف awriq-run.yml أولًا. لن ألعمك "استيقظ".`, events: [] };
  const wf = wfs[0].path.replace(/^\.github\/workflows\//, "");
  const r = await netJson(`${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/actions/workflows/${encodeURIComponent(wf)}/dispatches`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${ctx.gitToken}`, "user-agent": "AWRIQ-Agent/1.0", "content-type": "application/json" },
    body: JSON.stringify({ ref: ctx.repo.branch === "HEAD" ? "main" : ctx.repo.branch, inputs: { command } }),
  });
  if (!r.ok) return { ok: false, output: `فشل إطلاق الأمر عبر Actions: ${r.body?.message ?? `HTTP ${r.status}`}`, events: [], errorType: "unknown", statusCode: r.status };
  let run: any = null;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 5000));
    const runs = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/actions/workflows/${encodeURIComponent(wf)}/runs?per_page=1`);
    const r0 = Array.isArray(runs.body?.workflow_runs) ? runs.body.workflow_runs[0] : null;
    if (!r0) continue;
    run = r0;
    if (r0.status === "completed" || run?.conclusion) break;
  }
  if (!run) return { ok: false, output: `أُطلق "${command}" عبر Actions لكن عُدّمه الرصد في المهلة — تحقق من تبويب Actions.`, events: [{ commandDispatched: { workflow: wf, status: "dispatched" } }] };
  const concluded = run.conclusion ?? run.status;
  return {
    ok: concluded === "success",
    output: concluded === "success"
      ? `نفّذ GitHub Actions "${command}" بنجاح (conclusion=success). ${run.html_url ?? ""}`
      : `فشل "${command}" عبر Actions (conclusion=${concluded}). ${run.html_url ?? ""} — لا أعتبر المشكلة منتهية.`,
    events: [{ commandDispatched: { workflow: wf, run_url: run.html_url ?? undefined, status: String(concluded) } }],
  };
}

// ---------- Database tools ----------
async function execDbSelect(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  const table = String(args?.table ?? "").trim();
  if (!READ_TABLES.includes(table)) return { ok: false, output: `db_select يسمح فقط بـ: ${READ_TABLES.join(", ")}`, events: [], errorType: "invalid" };
  const columns = String(args?.columns ?? "*").trim();
  if (columns !== "*" && columns.split(",").some((c) => !COL_RE.test(c.trim()))) return { ok: false, output: "أعمدة غير صالحة", events: [], errorType: "invalid" };
  const limit = Math.min(Math.max(args?.limit ?? 20, 1), 100);
  const page = Math.max(args?.page ?? 1, 1);
  const order = String(args?.order ?? "created_at");
  if (!COL_RE.test(order)) return { ok: false, output: "order غير صالحة", events: [], errorType: "invalid" };

  let q: any = ctx.supabase.from(table).select(columns, { count: "exact" });
  const where: Array<[string, string]> = Array.isArray(args?.where) ? args.where : [];
  const like: Array<[string, string]> = Array.isArray(args?.like) ? args.like : [];
  for (const [c, v] of where) { if (COL_RE.test(String(c))) q = q.eq(String(c), String(v)); }
  for (const [c, v] of like) { if (COL_RE.test(String(c))) q = q.ilike(String(c), `%${String(v)}%`); }
  q = q.order(order, { ascending: String(args?.order_dir ?? "desc") !== "desc" });
  const offset = (page - 1) * limit;
  q = q.range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) {
    let extra = "";
    if (error.code === "42703" && KNOWN_COLUMNS[table]) extra = ` الأعمدة الحقيقية في ${table}: ${KNOWN_COLUMNS[table].join(", ")}.`;
    return { ok: false, output: `Supabase فشل: ${error.code ?? ""} ${error.message ?? String(error)}.${extra}`, events: [], errorType: error.code === "PGRST116" ? "not_found" : error.code === "22023" ? "invalid" : "unknown", statusCode: 0 };
  }
  const rows = (data ?? []) as any[];
  const peek = (r: any) => (r?.name_ar ? `${r.name_ar} (${r.name ?? ""})` : r?.name ?? r?.id ?? "سجل");
  const header = [`db_select ${table} — عناصر: ${count ?? rows.length}، صفحة ${page} (حد ${limit})`, ...rows.slice(0, 5).map((r) => `- ${peek(r)} (id ${r.id?.slice?.(0, 8) ?? "?"})`)];
  const out = JSON.stringify({ table, count: count ?? rows.length, page, limit, truncated: rows.length < (count ?? 0), rows }, null, 1);
  return { ok: true, output: maskSecrets(truncate(header.join("\n") + "\n" + out, 18000), ctx), events: [] };
}

async function execDbDelete(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  const table = String(args?.table ?? "").trim();
  if (!DELETE_TABLES.includes(table)) return { ok: false, output: `db_delete يسمح فقط بـ: ${DELETE_TABLES.join(", ")}`, events: [], errorType: "invalid" };
  const id = String(args?.id ?? "").trim();
  const reason = String(args?.reason ?? "").trim();
  if (!id) return { ok: false, output: "id مطلوب", events: [], errorType: "invalid" };

  const { data: row, error } = await ctx.supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (error) return { ok: false, output: `Supabase فشل: ${error.code ?? ""} ${error.message ?? String(error)}`, events: [], errorType: "unknown" };
  if (!row) return { ok: false, output: `لا يوجد سجل بهذه id في ${table} (التحقق الفعلي قبل الحذف).`, events: [], errorType: "not_found" };

  const label = rowLabel(row);
  const { data: approval, error: aErr } = await ctx.supabase
    .from("agent_approvals")
    .insert({
      project_id: ctx.projectId,
      user_id: ctx.requestUserId,
      action_type: "database_write",
      description: `حذف سجل من ${table} («${label.slice(0, 60)}»)${reason ? ` — ${reason.slice(0, 120)}` : ""}`,
      risk_level: "high",
      files_affected: [],
      status: "pending",
      payload: { action: "db_delete", table, id, label: label.slice(0, 120), reason },
    })
    .select("id").single();

  if (aErr || !approval?.id) return { ok: false, output: `فشل حفظ طلب الموافقة: ${aErr?.message ?? "؟"}`, events: [], errorType: "unknown" };

  return {
    ok: true,
    output: `وجدت: «${label}» في ${table} (id ${id}). الحذف عمل حساس — طلبت موافقة #${approval.id}. توقف الآن وانتظر الموافقة قبل أي أداة أخرى.`,
    events: [{ approvalRequired: { id: String(approval.id), description: `حذف «${label.slice(0, 60)}» من ${table}`, risk_level: "high", files_affected: [], table } }],
  };
}

// ---------- Vercel ----------
async function execVercelList(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.vercelToken) return { ok: false, output: "لا اعتماد Vercel لهذا المشروع في خزنة AWRIQ.", events: [], errorType: "auth" };
  const limit = Math.min(Math.max(args?.limit ?? 5, 1), 20);
  const qs = ctx.vercelProjectId ? `?projectId=${encodeURIComponent(ctx.vercelProjectId)}&` : "?";
  const r = await netJson(`https://api.vercel.com/v6/deployments${qs}limit=${limit}`, { headers: { authorization: `Bearer ${ctx.vercelToken}` } });
  if (!r.ok) return { ok: false, output: `فشل قراءة نشرات Vercel (HTTP ${r.status}).`, events: [], errorType: "unknown", statusCode: r.status };
  const rows = (r.body?.deployments ?? []).map((d: any) => `- ${d.state} ${d.url} (${d.created})`);
  return { ok: true, output: maskSecrets(rows.join("\n") || "لا نشرات.", ctx), events: [] };
}