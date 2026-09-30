// awriq-agent / tools.ts — Backend Tool Runtime v3 (real execution only).
// Policy: لا نتيجة وهمية أبدًا. كل أداة تنفذ عملية حقيقية (GitHub/DB/Vercel/Actions) وتُخبر بصدق.
// الأسرار (توكنات/مفاتيح) تبقى داخل الخادم ولا تُرسل للمزوّد أو الواجهة.

export type AgentMode = "read" | "plan" | "edit_approval" | "edit_auto";
export type ToolTier = "read" | "write" | "exec" | "external" | "sensitive";

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
  projectName?: string;
  cache: { tree: { at: number; items: any[] } | null };
}

export interface ToolEvent {
  fileChanged?: { path: string; action: string; diff?: string };
  approvalRequired?: { id: string; description: string; risk_level: string; files_affected: string[]; table?: string; action: string };
  commandDispatched?: { workflow: string; run_url?: string; status: string };
  terminal?: { command: string; output: string; exitCode: number; status?: string; durationMs?: number; runUrl?: string };
}

export type ToolErrorType = "auth" | "not_found" | "limit" | "transient" | "invalid" | "unknown";

export interface ToolResult {
  ok: boolean;
  output: string;
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

async function ghGetRepo(ctx: AgentToolCtx): Promise<any | null> {
  if (!ctx.repo) return null;
  const r = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}`);
  return r.ok ? r.body : null;
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
  return present.length ? present : ([""] as string[]);
}

function hasRegExpMeta(pattern: string): boolean {
  return /[\\^$.*+?()[\]{}|]/.test(pattern);
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { i++; if (glob[i + 1] === "/") i++; re += "(?:.*/)?[^/]*"; }
      else { re += "[^/]*"; }
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      let end = glob.indexOf("}", i);
      const inner = glob.slice(i + 1, end < 0 ? undefined : end).split(",").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      re += "(?:" + inner + ")";
      i = end < 0 ? glob.length - 1 : end;
    } else if (/[.*+?^${}()|[\]\\]/.test(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}

// ---------- Diff حقيقي (مشغّل LCS بسيط مع قيود حجم) ----------
function makeUnifiedDiff(aText: string, bText: string, path: string): string {
  const a = aText.split("\n");
  const b = bText.split("\n");
  const header = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
  const big = a.length * b.length > 2_500_000;
  const emitHunks = (segments: Array<{ a: string[]; b: string[] }>): string => {
    let out = header;
    let aLine = 1;
    let bLine = 1;
    for (const seg of segments) {
      const del = seg.a.filter((l) => l.startsWith("-"));
      const add = seg.b.filter((l) => l.startsWith("+"));
      const ctx = seg.a.filter((l) => l.startsWith(" "));
      const total = seg.a.length + seg.b.length;
      out += `@@ -${aLine},${seg.a.length} +${bLine},${seg.b.length} @@\n`;
      out += [...seg.a, ...seg.b].join("\n") + "\n";
      aLine += seg.a.length;
      bLine += seg.b.length;
    }
    return out;
  };
  if (big) {
    return `${header}@@ -1,${a.length || 1} +1,${b.length || 1} @@\n${a.map((l) => "-" + l).join("\n")}\n${b.map((l) => "+" + l).join("\n")}\n`;
  }
  // خوارزمية بسيطة: LCS ثنائية الصفوف + تتبع للقطع الوسطى
  const aArr = a; const bArr = b;
  const match = (x: string, y: string) => x === y;
  const n = aArr.length; const m = bArr.length;
  const dp: number[][] = [new Array(m + 1).fill(0)];
  for (let i = 1; i <= n; i++) {
    const prev = dp[i - 1];
    const cur = new Array(m + 1).fill(0);
    for (let j = 1; j <= m; j++) {
      cur[j] = match(aArr[i - 1], bArr[j - 1]) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    dp.push(cur);
  }
  // بناء العمليات من جدول dp (n*m قد يكون كبيرًا لكن مقبول مع القيد أعلاه)
  const ops: Array<{ t: "=" | "-" | "+"; l: string }> = [];
  let i = n; let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && match(aArr[i - 1], bArr[j - 1]) && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.unshift({ t: "=", l: aArr[i - 1] }); i--; j--;
    } else if (i > 0 && (j === 0 || dp[i][j] === dp[i - 1][j])) {
      ops.unshift({ t: "-", l: aArr[i - 1] }); i--;
    } else {
      ops.unshift({ t: "+", l: bArr[j - 1] }); j--;
    }
  }
  // تجميع hunks بسياق 3 أسطر
  const segments: Array<{ a: string[]; b: string[] }> = [];
  let cur: { a: string[]; b: string[] } | null = null;
  let ctxRun = 0;
  const flush = () => { if (cur && (cur.a.length || cur.b.length)) segments.push(cur); cur = null; ctxRun = 0; };
  for (const op of ops) {
    if (op.t === "=") {
      ctxRun++;
      if (!cur) { if (ctxRun <= 3 || true) { cur = { a: [], b: [] }; } }
      if (cur) { cur.a.push(" " + op.l); cur.b.push(" " + op.l); }
      if (ctxRun > 6) flush();
    } else if (op.t === "-") {
      ctxRun = 0;
      if (!cur) cur = { a: [], b: [] };
      cur.a.push("-" + op.l);
    } else {
      ctxRun = 0;
      if (!cur) cur = { a: [], b: [] };
      cur.b.push("+" + op.l);
    }
  }
  flush();
  return segments.length ? emitHunks(segments) : "(لا فرق)";
}

// ---------- تطبيق Patch حقيقي (unified diff) ----------
function applyUnifiedPatch(content: string, patchText: string, path: string): string {
  const lines = content.length ? content.split("\n") : [];
  const patch = patchText.split("\n");
  const out: string[] = [];
  let cursor = 0; // أول سطر أصلي لم يُنسخ بعد
  let pi = 0;
  let applied = 0;

  while (pi < patch.length) {
    const header = patch[pi];
    if (!/^@@\s/.test(header)) { pi++; continue; }
    pi++;
    const mm = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!mm) throw new Error("ترويسة hunk غير صالحة: " + header);
    const aStart = parseInt(mm[1], 10);
    const aCount = mm[2] !== undefined ? parseInt(mm[2], 10) : 1;
    const seg: string[] = [];
    while (pi < patch.length && !/^@@\s/.test(patch[pi]) && !/^(--- |\+\+\+ |diff |index )/.test(patch[pi])) {
      seg.push(patch[pi]);
      pi++;
    }
    const target = aStart === 0 ? 0 : aStart - 1;
    if (target < cursor) throw new Error(`hunk متداخل أو غير مرتّب عند السطر ${aStart} (${path}).`);
    for (let k = cursor; k < target; k++) out.push(lines[k]);
    let aIdx = target;
    let removed = 0;
    for (const s of seg) {
      if (s.startsWith("\\")) continue;
      if (s === "") continue;
      const op = s[0];
      if (op === " ") {
        if (lines[aIdx] !== s.slice(1)) throw new Error(`سياق غير مطابق عند السطر ${aIdx + 1} (${path}) — الملف تغيّر أو الـ patch غير صحيح.`);
        out.push(lines[aIdx]);
        aIdx++;
      } else if (op === "-") {
        if (lines[aIdx] !== s.slice(1)) throw new Error(`سطر محذوف غير مطابق عند السطر ${aIdx + 1} (${path}) — لن يُطبَّق أي تغيير.`);
        aIdx++;
        removed++;
      } else if (op === "+") {
        out.push(s.slice(1));
      } else {
        throw new Error("سطر غير مفهوم في الـ hunk: " + s.slice(0, 60));
      }
    }
    if (removed !== aCount) throw new Error(`hunk يعد ${aCount} سطرًا محذوفًا لكنه طابق ${removed} (${path}) — لن يُطبَّق.`);
    cursor = aIdx;
    applied++;
  }
  if (!applied) throw new Error("لا hunk قابل للتطبيق (تحقق من الصيغة).");
  for (let k = cursor; k < lines.length; k++) out.push(lines[k]);
  return out.join("\n");
}

// ---------- سير عمل التشغيل الحقيقي (AWRIQ Run) ----------
const WORKFLOW_YAML = `name: AWRIQ Run
on:
  workflow_dispatch:
    inputs:
      command:
        description: Commands to run in the project workspace
        required: true
        type: string
permissions:
  contents: write
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Execute
        env:
          CMD: \$\{{ inputs.command }}
        shell: bash
        run: |
          set +e
          mkdir -p awriq_logs
          ( eval "$CMD" 2>&1 ; echo "AWRIQ_RC=$?" >&2 ; ) 2> awriq_logs/rc.txt | tee awriq_logs/output.txt
          code=$(tail -1 awriq_logs/rc.txt 2>/dev/null | sed -nE 's/.*AWRIQ_RC=([0-9]+).*/\\1/p')
          [ -n "$code" ] || code=1
          printf '%s' "$code" > awriq_logs/exit_code.txt
          echo "AWRIQ_EXIT_CODE=$code"
          exit 0
      - name: Publish logs
        if: always()
        env:
          BRANCH: awriq-logs/\$\{{ github.run_id }}
        shell: bash
        run: |
          set -e
          mkdir -p .awriq
          cp awriq_logs/output.txt .awriq/output.txt 2>/dev/null || true
          cp awriq_logs/exit_code.txt .awriq/exit_code.txt 2>/dev/null || true
          [ -s .awriq/exit_code.txt ] || printf '3' > .awriq/exit_code.txt
          git config user.name "AWRIQ Agent"
          git config user.email "agent@awriq.app"
          git checkout --orphan "$BRANCH" 2>/dev/null || git checkout "$BRANCH"
          git add .awriq
          git commit -q -m "awriq logs \$\{{ github.run_id }}" || true
          git push -f origin "$BRANCH" -q || true
          git checkout -qf "\$\{{ github.sha }}"
      - name: Exit with result code
        if: always()
        shell: bash
        run: |
          code=$(cat awriq_logs/exit_code.txt 2>/dev/null)
          [ -n "$code" ] || code=1
          exit "$code"
`;

// ---------- أدوات ----------
const tp = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: props, required });

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "يسرد ملفات مجلد محدد (dir) أو بنمط glob (pattern مثل src/pages/*.tsx) في المستودع الحقيقي. لا تُسرد الجذر كاملًا. البيانات (مدرسة/جلسة) = db_select.",
      parameters: tp({ dir: { type: "string", description: "مجلد محدد مثل src/ أو src/pages" }, pattern: { type: "string", description: "نمط glob اختياري" }, limit: { type: "number" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "يقرأ محتوى ملف حقيقي من المستودع (نص؛ ثنائي يُرفض).",
      parameters: tp({ path: { type: "string" }, max_lines: { type: "number" } }, ["path"]),
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "بحث نصي حقيقي في ملفات المستودع (كلمة → GitHub code search؛ نمط → فحص dمجلة محددة بمهلة). يُرجع file:line.",
      parameters: tp({ pattern: { type: "string" }, dir: { type: "string" }, path: { type: "string" }, limit: { type: "number" } }, ["pattern"]),
    },
  },
  {
    type: "function",
    function: {
      name: "edit",
      description: "يعدّل ملفًا حقيقيًا في المستودع بكتابة كامل new_content ثم Commit فعلي (وضع edit_approval يطلب موافقة). الإخراج يشمل الفرق الحقيقي.",
      parameters: tp({ path: { type: "string" }, new_content: { type: "string" }, commit_message: { type: "string" }, apply: { type: "string", enum: ["now", "ask"] } }, ["path", "new_content", "commit_message"]),
    },
  },
  {
    type: "function",
    function: {
      name: "write",
      description: "ينشئ ملفًا جديدًا فعليًا في المستودع (أو يستبدل موجودًا) ثم Commit حقيقي. وضع edit_approval يطلب موافقة.",
      parameters: tp({ path: { type: "string" }, content: { type: "string" }, commit_message: { type: "string" }, apply: { type: "string", enum: ["now", "ask"] } }, ["path", "content", "commit_message"]),
    },
  },
  {
    type: "function",
    function: {
      name: "patch",
      description: "يطبّق unified diff (من git diff) حقيقيًا على ملف ثم Commit فعلي. patch يجب أن تكون unified diff سليمة.",
      parameters: tp({ path: { type: "string" }, patch: { type: "string", description: "نص diff بصيغة @@ -l,n +l,n @@" }, commit_message: { type: "string" }, apply: { type: "string", enum: ["now", "ask"] } }, ["path", "patch", "commit_message"]),
    },
  },
  {
    type: "function",
    function: {
      name: "rm",
      description: "يحذف ملفًا فعليًا من المستودع (عملية حساسة — تتطلب موافقة دائمًا).",
      parameters: tp({ path: { type: "string" }, commit_message: { type: "string" }, reason: { type: "string" } }, ["path", "reason"]),
    },
  },
  {
    type: "function",
    function: {
      name: "shell",
      description: "ينفّذ أمرًا حقيقيًا في بيئة عمل المشروع عبر سير عمل AWRIQ Run (checkout + تشغيل في Workspace). يظهر Command/Output/Exit code الحقيقيين. أوامر مثل npm install / npm run build / npm test / git status / php ...",
      parameters: tp({ command: { type: "string" } }, ["command"]),
    },
  },
  {
    type: "function",
    function: {
      name: "setup_shell",
      description: "يثبّت سير عمل AWRIQ Run (.github/workflows/awriq-run.yml) في المستودع حتى تعمل أداة shell — يطلب موافقة لأنه ملف جديد.",
      parameters: tp({}),
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "حالة git حقيقية: الفرع الحالي، الالتزامات الأخيرة، التقدم/التأخر مقابل الافتراضي.",
      parameters: tp({ limit: { type: "number" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "فرق git حقيقي بين نقطتين/فرعين في المستودع.",
      parameters: tp({ base: { type: "string" }, head: { type: "string" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "git_branch",
      description: "يسرد الفروع الحقيقية، أو ينشئ فرعًا جديدًا من رأس الافتراضي (name).",
      parameters: tp({ name: { type: "string", description: "اسم فرع جديد (اختياري = سرد)" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "git_checkout",
      description: "يُحوّل عمل الجلسة إلى فرع (يُنشئه إن لم يوجد من رأس الافتراضي). العمليات التالية في الجلسة تعمل عليه.",
      parameters: tp({ branch: { type: "string" } }, ["branch"]),
    },
  },
  {
    type: "function",
    function: {
      name: "git_push",
      description: "دفع حقيقي: يدمج فرع الجلسة الحالي في الفرع الافتراضي عبر GitHub. عملية حساسة — تتطلب موافقة دائمًا.",
      parameters: tp({ branch: { type: "string", description: "فرع المصدر (افتراضيًا فرع الجلسة)" }, message: { type: "string" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "github_repo",
      description: "بيانات المستودع الحقيقية (الـ default branch، public/private، آخر نشاط).",
      parameters: tp({}),
    },
  },
  {
    type: "function",
    function: {
      name: "db_select",
      description: "استعلام قراءة حقيقي على قاعدة بيانات AWRIQ. مصدر الحقيقة: المدارس=institutions، الجلسات=sessions...",
      parameters: tp({
        table: { type: "string", enum: ["institutions", "sessions", "institution_admins", "projects", "project_integrations", "project_members", "user_profiles", "organizations", "roles", "agent_runs", "agent_sessions", "activity_logs", "deployment_records"] },
        columns: { type: "string" },
        where: { type: "array", items: { type: "array", items: { type: "string" } }, description: "مساوَات: [['name_ar','الأمل']]" },
        like: { type: "array", items: { type: "array", items: { type: "string" } }, description: "مطابقة جزئية: [['name_ar','الأمل']]" },
        order: { type: "string" }, order_dir: { type: "string", enum: ["asc", "desc"] }, limit: { type: "number" }, page: { type: "number" },
      }, ["table"]),
    },
  },
  {
    type: "function",
    function: {
      name: "db_describe",
      description: "وصف حقيقي لجدول DB: الأعمدة + عدد السجلات — قبل أي استعلام غير متأكد.",
      parameters: tp({ table: { type: "string", enum: ["institutions", "sessions", "institution_admins", "projects", "project_integrations", "project_members", "user_profiles", "organizations", "roles", "agent_runs", "agent_sessions", "activity_logs", "deployment_records"] } }, ["table"]),
    },
  },
  {
    type: "function",
    function: {
      name: "db_delete",
      description: "حذف سجل من DB (حساس) — يطلب موافقة دائمًا. يعرض السجل قبل طلب الحذف.",
      parameters: tp({ table: { type: "string", enum: ["institutions", "sessions", "institution_admins"] }, id: { type: "string" }, reason: { type: "string" } }, ["table", "id", "reason"]),
    },
  },
  {
    type: "function",
    function: {
      name: "vercel_list",
      description: "يسرد نشرات Vercel الحقيقية للمشروع (إن وُجد اعتماد).",
      parameters: tp({ limit: { type: "number" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "vercel_deploy",
      description: "نشر حقيقي لـ Vercel (حساس — يطلب موافقة دائمًا). target=production أو preview.",
      parameters: tp({ target: { type: "string", enum: ["production", "preview"] }, ref: { type: "string", description: "فرع/نقطة النشر (افتراضيًا فرع الجلسة)" } }, ["target"]),
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

const noRepo = () => ({ ok: false, output: "لا مستودع GitHub مرتبط بهذا المشروع في السياق.", events: [], errorType: "invalid" as const });
const noToken = () => ({
  ok: false,
  output: "لا يوجد GitHub credential لهذا المشروع في خزنة AWRIQ (project_credentials). أضِفه من تبويب الوصول ثم أعد المحاولة.",
  events: [],
  errorType: "auth" as const,
});

// ---------- بوابات الصلاحيات (Permissions) ----------
function gateWrite(ctx: AgentToolCtx): ToolResult | null {
  if (ctx.mode === "read") return { ok: false, output: "وضع «قراءة فقط»: لا يسمح بأي تعديل/كتابة. اختر وضع إصلاح بموافقة أو تطوير كامل.", events: [], errorType: "invalid" };
  if (ctx.mode === "plan") return { ok: false, output: "وضع «تخطيط»: قراءة + تخطيط فقط، دون تنفيذ تعديلات.", events: [], errorType: "invalid" };
  return null;
}
function gateExec(ctx: AgentToolCtx): ToolResult | null {
  if (ctx.mode === "read") return { ok: false, output: "وضع «قراءة فقط»: لا يسمح بتشغيل أوامر.", events: [], errorType: "invalid" };
  if (ctx.mode === "plan") return { ok: false, output: "وضع «تخطيط»: لا يسمح بتشغيل أوامر.", events: [], errorType: "invalid" };
  return null;
}

// ---------- طلبات الموافقة (Approvals) ----------
type ApprovalInput = {
  action: string; action_type: string; description: string; risk_level: "low" | "medium" | "high";
  files_affected: string[]; payload: any;
};
async function requestApproval(ctx: AgentToolCtx, a: ApprovalInput): Promise<{ id: string } | { error: string }> {
  const { data, error } = await ctx.supabase
    .from("agent_approvals")
    .insert({
      project_id: ctx.projectId, user_id: ctx.requestUserId,
      action_type: a.action_type, description: a.description.slice(0, 240),
      risk_level: a.risk_level, files_affected: a.files_affected,
      status: "pending", payload: { ...a.payload, action: a.action },
    })
    .select("id").single();
  return error || !data?.id ? { error: error?.message ?? "فشل حفظ الموافقة" } : { id: String(data.id) };
}

// ---------- تشغيل ملف على GitHub (حقيقي) ----------
async function fetchRepoContent(ctx: AgentToolCtx, path: string): Promise<{ text: string; sha: string } | null> {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  const r = await ghRequest(ctx, `${GH}/repos/${ctx.repo!.owner}/${ctx.repo!.repo}/contents/${enc}?ref=${encodeURIComponent(ctx.repo!.branch)}`);
  if (r.status === 404) return null;
  if (!r.ok || typeof r.body?.content !== "string") return null;
  return { text: atob(r.body.content), sha: r.body.sha };
}

function b64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))));
  }
  return btoa(bin);
}

function fileChangeResult(path: string, oldText: string | null, newText: string, summary: string, commitSha: string): ToolResult {
  const diff = makeUnifiedDiff(oldText ?? "", newText, path);
  const out = [`${summary}`];
  if (commitSha) out.push(`commit: ${commitSha.slice(0, 7)}`);
  if (oldText === null) out.push(`(ملف جديد — الفرق أدناه)`);
  out.push(diff);
  return { ok: true, output: maskSecrets(out.join("\n"), { repo: null, gitToken: null, vercelToken: null, vercelProjectId: null, supabase: null, serviceKey: "", mode: "read", projectId: null, requestUserId: null, cache: { tree: null } } as any), events: [{ fileChanged: { path, action: oldText === null ? "created" : "modified", diff } }] };
}

async function commitFileContent(ctx: AgentToolCtx, path: string, newText: string, msg: string, oldInfo: { text: string; sha: string } | null): Promise<ToolResult> {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  const commit = await ghRequest(ctx, `${GH}/repos/${ctx.repo!.owner}/${ctx.repo!.repo}/contents/${enc}`, {
    method: "PUT",
    body: JSON.stringify({ message: msg, content: b64Utf8(newText), sha: oldInfo?.sha ?? undefined, branch: ctx.repo!.branch }),
  });
  if (!commit.ok || !commit.body?.content?.sha) {
    return { ok: false, output: `فشل الالتزام على ${path} (HTTP ${commit.status}): ${commit.body?.message ?? "لا خبر"} — لم يُطبّق.`, events: [], errorType: "unknown", statusCode: commit.status };
  }
  return fileChangeResult(path, oldInfo?.text ?? null, newText, `التزمت التغيير فعليًا على ${path} (فرع ${ctx.repo!.branch})`, commit.body.commit?.sha ?? commit.body.content.sha);
}

async function requestFileApproval(ctx: AgentToolCtx, path: string, newText: string, msg: string, oldInfo: { text: string; sha: string } | null, risk: "medium" | "high" = "medium"): Promise<ToolResult> {
  const rq = await requestApproval(ctx, {
    action: "file", action_type: "file_modify", risk_level: risk, files_affected: [path],
    description: msg, payload: { path, new_content: newText, commit_message: msg, old: oldInfo?.text ?? null, old_sha: oldInfo?.sha ?? null },
  });
  if ("error" in rq) return { ok: false, output: `فشل حفظ طلب الموافقة: ${rq.error}`, events: [], errorType: "unknown" };
  return {
    ok: true,
    output: `أرسلت طلب موافقة #${rq.id} لتغيير ${path} («${msg}»). توقف وانتظر القرار.`,
    events: [{ approvalRequired: { id: rq.id, description: msg, risk_level: risk, files_affected: [path], action: "file" } }],
  };
}

// ---------- File tools ----------
async function execListFiles(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  const tree = await ghTree(ctx);
  const dir = String(args?.dir ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const pattern = String(args?.pattern ?? "").trim();
  const limit = Math.min(Math.max(args?.limit ?? 80, 1), 300);
  if (!dir && !pattern) {
    return { ok: false, output: "list_files يحتاج dir محددًا (مثل src/pages) أو pattern glob (مثل *.tsx في مجلد). للبيانات استخدم db_select.", events: [], errorType: "invalid" };
  }
  const re = pattern ? globToRegExp(pattern) : null;
  const blobs = tree.filter((t: any) => t.type === "blob").map((t: any) => String(t.path));
  const rows = blobs.filter((p: string) => {
    const inDir = dir ? (p.startsWith(dir + "/") || p === dir) : true;
    const inPattern = re ? re.test(dir ? p.slice(dir.length + 1) : p) : true;
    return inDir && inPattern;
  }).slice(0, limit);
  const out = [`فهرس ${dir || (pattern ? `نمط ${pattern}` : "")} (حد: ${limit}) — ${rows.length} ملف`, "", ...rows.map((p: string) => `  ${p}`)].join("\n");
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
  const repo = ctx.repo;
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

  if (!hasRegExpMeta(pattern) && !ll) {
    const q = `${pattern} repo:${repo.owner}/${repo.repo}${dir ? ` path:/${dir}/` : ""}`;
    const r = await ghRequest(ctx, `${GH}/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`);
    if (r.ok && Array.isArray(r.body?.items)) {
      const paths = r.body.items.map((it: any) => it.path as string);
      if (paths.length === 0) return { ok: true, output: `لا نتائج لكلمة "${pattern}" (GitHub code search).`, events: [] };
      const hits: string[] = [];
      for (const p of paths) {
        const rr = await ghRequest(ctx, `${GH}/repos/${repo.owner}/${repo.repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(repo.branch)}`);
        if (typeof rr.body?.content !== "string") continue;
        const lines = atob(rr.body.content).split("\n");
        const idx = lines.map((l: string) => l.toLowerCase()).findIndex((l: string) => l.includes(pattern.toLowerCase()));
        hits.push(`سطر ${idx + 1} ${p}: ${lines[Math.max(idx, 0)]?.trim().slice(0, 220)}`);
      }
      return { ok: true, output: maskSecrets(truncate(`Code Search "${pattern}" → ${hits.length} تطابق\n${hits.join("\n")}`, 20000), ctx), events: [] };
    }
  }
  return fallback("code search غير متاح/غير دقيق");
}

async function execEdit(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const gate = gateWrite(ctx); if (gate) return gate;
  const path = String(args?.path ?? "").trim().replace(/^\/+/, "");
  const content = String(args?.new_content ?? "");
  const msg = String(args?.commit_message ?? `AWRIQ Agent: تعديل ${path}`).slice(0, 200);
  if (!path || !content) return { ok: false, output: "path و new_content مطلوبان", events: [], errorType: "invalid" };
  const oldInfo = await fetchRepoContent(ctx, path);
  if (ctx.mode !== "edit_auto") return requestFileApproval(ctx, path, content, msg, oldInfo);
  return commitFileContent(ctx, path, content, msg, oldInfo);
}

async function execWrite(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const gate = gateWrite(ctx); if (gate) return gate;
  const path = String(args?.path ?? "").trim().replace(/^\/+/, "");
  const content = String(args?.content ?? "");
  const msg = String(args?.commit_message ?? `AWRIQ Agent: إنشاء ${path}`).slice(0, 200);
  if (!path || !content) return { ok: false, output: "path و content مطلوبان", events: [], errorType: "invalid" };
  const oldInfo = await fetchRepoContent(ctx, path);
  if (ctx.mode !== "edit_auto") return requestFileApproval(ctx, path, content, msg, oldInfo);
  return commitFileContent(ctx, path, content, msg, oldInfo);
}

async function execPatch(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const gate = gateWrite(ctx); if (gate) return gate;
  const path = String(args?.path ?? "").trim().replace(/^\/+/, "");
  const patch = String(args?.patch ?? "");
  const msg = String(args?.commit_message ?? `AWRIQ Agent: patch ${path}`).slice(0, 200);
  if (!path || !patch) return { ok: false, output: "path و patch مطلوبان", events: [], errorType: "invalid" };
  const oldInfo = await fetchRepoContent(ctx, path);
  let newText: string;
  try { newText = applyUnifiedPatch(oldInfo?.text ?? "", patch, path); } catch (e) {
    return { ok: false, output: `فشل تطبيق patch (غير مطابق فعليًا): ${e instanceof Error ? e.message : String(e)}`, events: [], errorType: "invalid" };
  }
  if (ctx.mode !== "edit_auto") return requestFileApproval(ctx, path, newText, msg, oldInfo);
  return commitFileContent(ctx, path, newText, msg, oldInfo);
}

async function execRm(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const path = String(args?.path ?? "").trim().replace(/^\/+/, "");
  const reason = String(args?.reason ?? "").trim();
  const msg = String(args?.commit_message ?? `AWRIQ Agent: حذف ${path}`).slice(0, 200);
  if (!path || !reason) return { ok: false, output: "path و reason مطلوبان", events: [], errorType: "invalid" };
  const oldInfo = await fetchRepoContent(ctx, path);
  if (!oldInfo) return { ok: false, output: `الملف غير موجود في ${ctx.repo!.branch}: ${path}`, events: [], errorType: "not_found" };
  const rq = await requestApproval(ctx, {
    action: "rm", action_type: "file_delete", risk_level: "high", files_affected: [path],
    description: `حذف ملف ${path}${reason ? ` — ${reason.slice(0, 120)}` : ""}`, payload: { path, sha: oldInfo.sha, commit_message: msg, old: oldInfo.text, reason },
  });
  if ("error" in rq) return { ok: false, output: `فشل حفظ طلب الموافقة: ${rq.error}`, events: [], errorType: "unknown" };
  return { ok: true, output: `أرسلت طلب موافقة #${rq.id} لحذف ${path} (حساس). توقف وانتظر القرار.`, events: [{ approvalRequired: { id: rq.id, description: `حذف ملف ${path}`, risk_level: "high", files_affected: [path], action: "rm" } }] };
}

// ---------- Git ----------
async function execGitStatus(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const limit = Math.min(Math.max(args?.limit ?? 5, 1), 20);
  const repoInfo = await ghGetRepo(ctx);
  const def = repoInfo?.default_branch;
  const r = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/commits?sha=${encodeURIComponent(ctx.repo.branch)}&per_page=${limit}`);
  if (!Array.isArray(r.body)) return { ok: false, output: `فشل قراءة الالتزامات (HTTP ${r.status}).`, events: [], errorType: "unknown", statusCode: r.status };
  const rows = r.body.map((c: any) => `- ${c.sha.slice(0, 7)} ${c.commit?.message?.split("\n")[0].slice(0, 72)} (${c.commit?.author?.name ?? "?"}, ${c.commit?.author?.date ?? "?"})`);
  let ahead = "؟";
  if (def && def !== ctx.repo.branch) {
    const cp = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/compare/${encodeURIComponent(def)}...${encodeURIComponent(ctx.repo.branch)}`);
    if (cp.ok && cp.body) ahead = `vs default (${def}): +${cp.body.ahead_by}/-${cp.body.behind_by}`;
  }
  return { ok: true, output: maskSecrets(truncate([`الفرع: ${ctx.repo.branch} (default: ${def ?? "؟"})`, ahead === "؟" ? "" : ahead, "أحدث الالتزامات:", ...rows].join("\n"), 20000), ctx), events: [] };
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
  return { ok: true, output: maskSecrets(truncate([`الفرق ${base.slice(0, 10)}...${head} — ${r.body.total_commits} commit، +${r.body.ahead_by}/-${r.body.behind_by}`, ...files].join("\n"), 30000), ctx), events: [] };
}

async function execGitBranch(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const name = String(args?.name ?? "").trim().replace(/^\/+/, "");
  if (!name) {
    const rr = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/branches?per_page=100`);
    if (!Array.isArray(rr.body)) return { ok: false, output: `فشل قراءة الفروع (HTTP ${rr.status}).`, events: [], errorType: "unknown" };
    const branchNow = ctx.repo.branch;
    const rows = rr.body.map((b: any) => `- ${b.name}${b.name === branchNow ? "  ← (تفرع الجلسة الحالي)" : ""}`);
    return { ok: true, output: maskSecrets(rows.join("\n") || "(لا فروع)", ctx), events: [] };
  }
  const gate = gateWrite(ctx); if (gate) return gate;
  const repoInfo = await ghGetRepo(ctx);
  const base = repoInfo?.default_branch;
  const refR = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/git/ref/heads/${base}`);
  const baseSha = refR.ok && refR.body?.object?.sha ? refR.body.object.sha : null;
  if (!baseSha) return { ok: false, output: "تعذّر تحديد رأس الفرع الافتراضي لإنشاء الفرع.", events: [], errorType: "unknown" };
  const created = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/git/refs`, {
    method: "POST", body: JSON.stringify({ ref: `refs/heads/${name}`, sha: baseSha }),
  });
  if (!created.ok) return { ok: false, output: `فشل إنشاء الفرع ${name} (HTTP ${created.status}): ${created.body?.message ?? "؟"}`, events: [], errorType: "unknown", statusCode: created.status };
  return { ok: true, output: `أنشأت الفرع الحقيقي ${name} من نقطة ${base} (${baseSha.slice(0, 7)}).`, events: [] };
}

async function execGitCheckout(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const gate = gateWrite(ctx); if (gate) return gate;
  const name = String(args?.branch ?? "").trim().replace(/^\/+/, "");
  if (!name) return { ok: false, output: "branch مطلوب", events: [], errorType: "invalid" };
  const exists = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/git/ref/heads/${name}`);
  if (!exists.ok) {
    const repoInfo = await ghGetRepo(ctx);
    const base = repoInfo?.default_branch;
    const refR = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/git/ref/heads/${base}`);
    const baseSha = refR.ok && refR.body?.object?.sha ? refR.body.object.sha : null;
    if (!baseSha) return { ok: false, output: "تعذّر الحصول على رأس الافتراضي لإنشاء الفرع.", events: [], errorType: "unknown" };
    const created = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${name}`, sha: baseSha }) });
    if (!created.ok) return { ok: false, output: `تعذّرت العملانية على ${name} (HTTP ${created.status}): ${created.body?.message ?? "؟"}`, events: [], errorType: "unknown" };
  }
  ctx.repo = { ...ctx.repo, branch: name };
  return { ok: true, output: `حُوِّلت الجلسة إلى فرع ${name} — العمليات القادمة (قراءة/تعديل/دفع) تعمل عليه فعليًا.`, events: [] };
}

async function execGitPush(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const head = String(args?.branch ?? ctx.repo.branch).trim() || ctx.repo.branch;
  const repoInfo = await ghGetRepo(ctx);
  const base = repoInfo?.default_branch;
  if (!base) return { ok: false, output: "تعذّر معرفة الفرع الافتراضي.", events: [], errorType: "unknown" };
  if (head === base) {
    const r0 = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/commits?sha=${encodeURIComponent(head)}&per_page=1`);
    return { ok: true, output: `الفرع ${head} هو الفرع الافتراضي — الالتزامات جرت فيه مباشرة (آخرها ${Array.isArray(r0.body) && r0.body[0] ? r0.body[0].sha.slice(0, 7) : "؟"}). لا يوجد دفع منفصل كي ننفذه.`, events: [] };
  }
  const message = String(args?.message ?? `AWRIQ Agent: دمج ${head} في ${base}`).slice(0, 200);
  const rq = await requestApproval(ctx, {
    action: "git_push", action_type: "git_push", risk_level: "high", files_affected: [],
    description: `git push — دمج ${head} → ${base} (${message.slice(0, 100)})`, payload: { head, base, message },
  });
  if ("error" in rq) return { ok: false, output: `فشل حفظ طلب الموافقة: ${rq.error}`, events: [], errorType: "unknown" };
  return { ok: true, output: `الدفع عملية حساسة — أرسلت موافقة #${rq.id} لدمج ${head} في ${base}. توقف وانتظر القرار.`, events: [{ approvalRequired: { id: rq.id, description: `git push: دمج ${head} في ${base}`, risk_level: "high", files_affected: [], action: "git_push" } }] };
}

async function execGithubRepo(_args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  const repo = await ghGetRepo(ctx);
  if (!repo) return { ok: false, output: "تعذّر قراءة بيانات المستودع.", events: [], errorType: "unknown" };
  return { ok: true, output: maskSecrets(JSON.stringify({ name: repo.full_name, default_branch: repo.default_branch, private: repo.private, archived: repo.archived, language: repo.language, size_kb: repo.size, pushed_at: repo.pushed_at, stars: repo.stargazers_count, open_issues: repo.open_issues_count }, null, 1), ctx), events: [] };
}

// ---------- shell (تنفيذ حقيقي عبر AWRIQ Run) ----------
async function findRunWorkflow(ctx: AgentToolCtx): Promise<string | null> {
  const tree = await ghTree(ctx);
  const wf = tree.find((t: any) => t.type === "blob" && /^\.github\/workflows\/awriq-run\.ya?ml$/.test(t.path));
  return wf ? wf.path.replace(/^\.github\/workflows\//, "") : null;
}

async function execShell(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const gate = gateExec(ctx); if (gate) return gate;
  const command = String(args?.command ?? "").trim();
  if (!command) return { ok: false, output: "command مطلوب", events: [], errorType: "invalid" };
  let wf = await findRunWorkflow(ctx);
  if (!wf) {
    const rq = await requestApproval(ctx, {
      action: "file", action_type: "file_modify", risk_level: "medium", files_affected: [".github/workflows/awriq-run.yml"],
      description: "تثبيت سير عمل AWRIQ Run (أداة shell الحقيقية) في المستودع", payload: { path: ".github/workflows/awriq-run.yml", new_content: WORKFLOW_YAML, commit_message: "chore: install AWRIQ Run workflow (real shell)", old: null, old_sha: null },
    });
    if ("error" in rq) return { ok: false, output: `فشل تثبيت سير العمل: ${rq.error}`, events: [], errorType: "unknown" };
    return { ok: false, output: `أداة shell تحتاج سير عمل AWRIQ Run — أرسلت طلب موافقة #${rq.id} لتثبيته. بعد الموافقة أعد استدعاء shell بنفس الأمر.`, events: [{ approvalRequired: { id: rq.id, description: "تثبيت سير عمل AWRIQ Run (shell حقيقي)", risk_level: "medium", files_affected: [".github/workflows/awriq-run.yml"], action: "file" } }] };
  }
  const ref = ctx.repo.branch === "HEAD" ? (await ghGetRepo(ctx))?.default_branch ?? "main" : ctx.repo.branch;
  const dispatch = await netJson(`${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/actions/workflows/${encodeURIComponent(wf)}/dispatches`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${ctx.gitToken}`, "user-agent": "AWRIQ-Agent/1.0", "content-type": "application/json" },
    body: JSON.stringify({ ref, inputs: { command } }),
  });
  if (!dispatch.ok) return { ok: false, output: `فشل إطلاق shell عبر Actions (HTTP ${dispatch.status}): ${dispatch.body?.message ?? "؟"}`, events: [], errorType: "unknown", statusCode: dispatch.status };

  // انتظار ظهور التشغيل
  const dispatchDate = Date.now() - 5000;
  let run: any = null;
  {
    const pollRun = Date.now() + 20000;
    while (Date.now() < pollRun) {
      await new Promise((res) => setTimeout(res, 3000));
      const runs = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/actions/runs?per_page=10`);
      const cand = (runs.body?.workflow_runs ?? []).find((a: any) => a.workflow_id && String(a.workflow_id) !== "0" && new Date(a.created_at).getTime() >= dispatchDate);
      if (cand) { run = cand; break; }
    }
  }
  if (!run) return { ok: false, output: `أُرسل الأمر "${command}" (سير عمل ${wf}) لكن التشغيل لم يظهر خلال المهلة — تحقق من تبويب Actions.`, events: [{ commandDispatched: { workflow: wf, status: "dispatched" } }], errorType: "limit" };

  const url = run.html_url;
  const deadline = Date.now() + 75000;
  while (Date.now() < deadline) {
    if (run.status === "completed" && run.conclusion) break;
    await new Promise((res) => setTimeout(res, 5000));
    const rr = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/actions/runs/${run.id}`);
    if (rr.ok && rr.body) run = rr.body;
    if (run.status === "completed" || run.conclusion) break;
  }

  if (!(run.status === "completed" && run.conclusion)) {
    return { ok: false, output: `لم يكتمل "${command}" خلال المهلة (زمن ${((Date.now() - dispatchDate) / 1000).toFixed(0)}ث) — التشغيل قيد التقدم أو بانتظار الموارد: ${url}`, events: [{ commandDispatched: { workflow: wf, run_url: url, status: run.status } }], errorType: "limit" };
  }

  // قراءة المخرجات الحقيقية من فرع الصحف المؤقت
  const branch = `awriq-logs/${run.id}`;
  const repoFor = { owner: ctx.repo.owner, repo: ctx.repo.repo, branch: ctx.repo.branch };

  let output = "";
  let exitCode: number | null = null;
  const readLogs = async (): Promise<void> => {
    const or = await ghRequest(ctx, `${GH}/repos/${repoFor.owner}/${repoFor.repo}/contents/.awriq/output.txt?ref=${encodeURIComponent(branch)}`);
    const er = await ghRequest(ctx, `${GH}/repos/${repoFor.owner}/${repoFor.repo}/contents/.awriq/exit_code.txt?ref=${encodeURIComponent(branch)}`);
    if (or.ok && typeof or.body?.content === "string") output = atob(or.body.content);
    if (er.ok && typeof er.body?.content === "string") exitCode = parseInt(atob(er.body.content), 10);
  };
  await readLogs();
  if (output === "" && exitCode === null) {
    // fallback: سجلات الوظيفة الفعلية
    const jr = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/actions/runs/${run.id}/jobs`);
    const job = Array.isArray(jr.body?.jobs) ? jr.body.jobs[0] : null;
    if (job?.id) {
      const logs = await netJson(`${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/actions/jobs/${job.id}/logs`, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${ctx.gitToken}` } });
      if (logs.ok && typeof logs.body === "string") {
        const m = logs.body.match(/AWRIQ_EXIT_CODE=(\d+)/);
        if (m) exitCode = parseInt(m[1], 10);
        output = logs.body.replace(/\r\n/g, "\n").split("\n").filter((l: string) => !/^(\d+ )?(##\[|::(group|endgroup|error|notice|warning)|Post |Compressing|Uploading|Extracting|Preparing workspace|Running .*test-$|Cleaning up)/.test(l)).join("\n").slice(0, 24000);
      }
    }
  } else {
    // تنظيف فرع الصحف المؤقت
    await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "DELETE" }).catch?.(() => {});
  }
  const finalCode = exitCode ?? (run.conclusion === "success" ? 0 : 1);
  const statusTxt = finalCode === 0 ? "success" : "failed";
  const body = `$ ${command}\n\n${output || "(لا مخرجات)"}\n\nExit code: ${finalCode}\nStatus: ${statusTxt}`;
  return {
    ok: finalCode === 0,
    output: maskSecrets(truncate(body, 20000), ctx),
    events: [{ terminal: { command, output: maskSecrets(truncate(output, 16000), ctx), exitCode: finalCode, status: statusTxt, runUrl: url }, commandDispatched: { workflow: wf, run_url: url, status: `${statusTxt} (exit ${finalCode})` } }],
  };
}

async function execSetupShell(_args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.repo) return noRepo();
  if (!ctx.gitToken) return noToken();
  const gate = gateWrite(ctx); if (gate) return gate;
  if (await findRunWorkflow(ctx)) return { ok: true, output: "سير عمل AWRIQ Run مثبّت مسبقًا — أداة shell جاهزة.", events: [] };
  return requestFileApproval(ctx, ".github/workflows/awriq-run.yml", WORKFLOW_YAML, "chore: install AWRIQ Run workflow (real shell)", null);
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

async function execDbDescribe(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  const table = String(args?.table ?? "").trim();
  if (!READ_TABLES.includes(table)) return { ok: false, output: `db_describe يسمح فقط بـ: ${READ_TABLES.join(", ")}`, events: [], errorType: "invalid" };
  const cols = KNOWN_COLUMNS[table] ?? [];
  let count: number | null = null;
  try {
    const res: any = await ctx.supabase.from(table).select("id", { count: "exact", head: true });
    count = res?.count ?? null;
  } catch (e) {
    count = null;
  }
  return { ok: true, output: `جدول ${table} — أعمدة (${cols.length}): ${cols.join(", ")}\nسجلات: ${count ?? "؟"}`, events: [] };
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
  const rq = await requestApproval(ctx, {
    action: "db_delete", action_type: "database_write", risk_level: "high", files_affected: [],
    description: `حذف سجل من ${table} («${label.slice(0, 60)}»)${reason ? ` — ${reason.slice(0, 120)}` : ""}`,
    payload: { table, id, label: label.slice(0, 120), reason },
  });
  if ("error" in rq) return { ok: false, output: `فشل حفظ طلب الموافقة: ${rq.error}`, events: [], errorType: "unknown" };
  return { ok: true, output: `وجدت: «${label}» في ${table} (id ${id}). الحذف حساس — طلبت موافقة #${rq.id}. توقف وانتظر القرار.`, events: [{ approvalRequired: { id: rq.id, description: `حذف «${label.slice(0, 60)}» من ${table}`, risk_level: "high", files_affected: [], table, action: "db_delete" } }] };
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

async function execVercelDeploy(args: any, ctx: AgentToolCtx): Promise<ToolResult> {
  if (!ctx.vercelToken) return { ok: false, output: "لا اعتماد Vercel لهذا المشروع — أضِفه من تبويب الوصول.", events: [], errorType: "auth" };
  if (!ctx.vercelProjectId) return { ok: false, output: "لا معرف مشروع Vercel في الاعتماد — أضِفه أولًا.", events: [], errorType: "auth" };
  const target = String(args?.target ?? "production");
  const ref = String(args?.ref ?? ctx.repo?.branch ?? "main");
  const rq = await requestApproval(ctx, {
    action: "vercel_deploy", action_type: "deploy", risk_level: "high", files_affected: [],
    description: `نشر Vercel إلى ${target} (ref=${ref})`, payload: { target, ref, projectId: ctx.vercelProjectId },
  });
  if ("error" in rq) return { ok: false, output: `فشل حفظ طلب الموافقة: ${rq.error}`, events: [], errorType: "unknown" };
  return { ok: true, output: `النشر ${target} حساس — موافقة #${rq.id}. توقف وانتظر القرار.`, events: [{ approvalRequired: { id: rq.id, description: `نشر Vercel إلى ${target} (ref=${ref})`, risk_level: "high", files_affected: [], action: "vercel_deploy" } }] };
}

// ---------- موزّع الأدوات ----------
export async function runTool(name: string, argsStr: string, ctx: AgentToolCtx): Promise<ToolResult> {
  const started = Date.now();
  const args = parseArgs(argsStr);
  const exec = (): Promise<ToolResult> => {
    switch (name) {
      case "list_files": return execListFiles(args, ctx);
      case "read_file": return execReadFile(args, ctx);
      case "search_files": return execSearch(args, ctx);
      case "edit":
      case "edit_file": return execEdit(args, ctx);
      case "write": return execWrite(args, ctx);
      case "patch": return execPatch(args, ctx);
      case "rm": return execRm(args, ctx);
      case "shell":
      case "run_command": return execShell(args, ctx);
      case "setup_shell": return execSetupShell(args, ctx);
      case "git_status": return execGitStatus(args, ctx);
      case "git_diff": return execGitDiff(args, ctx);
      case "git_branch": return execGitBranch(args, ctx);
      case "git_checkout": return execGitCheckout(args, ctx);
      case "git_push": return execGitPush(args, ctx);
      case "github_repo": return execGithubRepo(args, ctx);
      case "db_select":
      case "supabase_select": return execDbSelect(args, ctx);
      case "db_describe": return execDbDescribe(args, ctx);
      case "db_delete": return execDbDelete(args, ctx);
      case "vercel_list": return execVercelList(args, ctx);
      case "vercel_deploy": return execVercelDeploy(args, ctx);
      default: return Promise.resolve({ ok: false, output: `أداة غير معروفة: ${name}`, events: [], errorType: "invalid" });
    }
  };
  try {
    const r = await exec();
    r.durationMs = Date.now() - started;
    return r;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const transient = /(timeout|Timed out|network|fetch failed|could not connect|503|502)/i.test(msg);
    const r: ToolResult = { ok: false, output: maskSecrets(truncate(msg), ctx), events: [], errorType: transient ? "transient" : "unknown", durationMs: Date.now() - started };
    if (transient) {
      try { return { ...(await exec()), retried: true, durationMs: Date.now() - started }; } catch { /* ignore */ }
    }
    return r;
  }
}

// ---------- تطبيق المعتمَد فعليًا (بيانات payload) ----------
export async function applyApproval(ctx: AgentToolCtx, act: any): Promise<string> {
  const action = String(act?.action ?? "");
  if (action === "file" || action === "setup_shell") {
    if (!ctx.repo || !ctx.gitToken) return "لا مستودع/توكن لتطبيقها.";
    const path = String(act.path ?? "").split("/").map(encodeURIComponent).join("/");
    const msg = String(act.commit_message ?? "AWRIQ Agent (معتمَد)");
    // تحقق من عدم تعارض التحديث (sha المحفوظ)
    const cur = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${path}?ref=${encodeURIComponent(ctx.repo.branch)}`);
    const curSha = cur.ok && cur.body?.sha ? cur.body.sha : null;
    if (act.old_sha && curSha && curSha !== act.old_sha) {
      return `صراع: تغيّر ${act.path} خارج الجلسة (sha مختلف). لن أطبّق فوق تغيير غير محفوظ — راجع Manuel، أو استخدم edit/read على أحدث نسخة.`;
    }
    const commit = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify({ message: msg, content: b64Utf8(String(act.new_content ?? "")), sha: curSha ?? undefined, branch: ctx.repo.branch }),
    });
    if (!commit.ok || !commit.body?.content?.sha) return `فشل تطبيق التعديل المعتمَد على ${act.path} (HTTP ${commit.status}): ${commit.body?.message ?? "؟"}`;
    const diff = makeUnifiedDiff(String(act.old ?? ""), String(act.new_content ?? ""), String(act.path));
    return `نُفّذ التعديل المعتمَد فعليًا على ${act.path} (commit ${commit.body.commit?.sha?.slice?.(0, 7) ?? "؟"}).\n${diff.slice(0, 4000)}`;
  }
  if (action === "rm") {
    if (!ctx.repo || !ctx.gitToken) return "لا مستودع/توكن.";
    const path = String(act.path ?? "").split("/").map(encodeURIComponent).join("/");
    const del = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/contents/${path}`, {
      method: "DELETE",
      body: JSON.stringify({ message: String(act.commit_message ?? "AWRIQ Agent: حذف معتمَد"), sha: String(act.sha ?? ""), branch: ctx.repo.branch }),
    });
    if (!del.ok) return `فشل حذف ${act.path} (HTTP ${del.status}): ${del.body?.message ?? "؟"} — لم يُحذف شيء.`;
    return `حُذف الملف فعليًا: ${act.path} (commit ${del.body?.commit?.sha?.slice?.(0, 7) ?? "؟"}).`;
  }
  if (action === "db_delete") {
    const table = String(act.table ?? "");
    const id = String(act.id ?? "");
    if (!["institutions", "sessions", "institution_admins"].includes(table) || !id) return "طلب حذف غير صالح.";
    const { data: deleted, error } = await ctx.supabase.from(table).delete().eq("id", id).select("*");
    if (error || !deleted?.length) {
      const { data: gone } = await ctx.supabase.from(table).select("id").eq("id", id).maybeSingle();
      if (!gone) return `السجل (id ${id}) لم يعد موجودًا في ${table} (محذوف مسبقًا).`;
      return `فشل الحذف الفعلي من ${table} (id ${id}): ${error?.message ?? "لا خبر"} — لم يُحذف شيء.`;
    }
    const { data: still } = await ctx.supabase.from(table).select("id").eq("id", id).maybeSingle();
    return still ? `حُذف صف؟ التحقق ما زال يعرضه — فحص يدويًا.` : `نُفِّذ الحذف المعتمَد: «${act.label ?? "؟"}» من ${table} (id ${id}) حُذفت فعليًا.`;
  }
  if (action === "git_push") {
    if (!ctx.repo || !ctx.gitToken) return "لا مستودع/توكن.";
    const { head, base, message } = act;
    const merge = await ghRequest(ctx, `${GH}/repos/${ctx.repo.owner}/${ctx.repo.repo}/merges`, {
      method: "POST",
      body: JSON.stringify({ base: String(base), head: String(head), commit_message: String(message ?? `Merge ${head} into ${base}`).slice(0, 200) }),
    });
    if (merge.status === 409) return `تعذّر الدمج: تعارض فعلي بين ${head} و ${base} (HTTP 409). الدفع لم يتم — حُلّ التعارض أولًا.`;
    if (merge.status === 204 || (merge.ok && !merge.body?.sha)) return `لا يوجد دمج: الفرع ${head} مطابق لرئيس ${base} (لا تغييرات جديدة — HTTP ${merge.status}). لم أُنشئ أي دمج.`;
    if (!merge.ok) return `فشل الدفع (دمج ${head}→${base}) HTTP ${merge.status}: ${merge.body?.message ?? "؟"}`;
    return `تم الدفع الحقيقي: دُمج ${head} في ${base} (merge ${merge.body?.sha?.slice?.(0, 7) ?? "؟"}).`;
  }
  if (action === "vercel_deploy") {
    if (!ctx.vercelToken) return "لا اعتماد Vercel.";
    const { target, ref, projectId } = act;
    const repoInfo = ctx.repo ? (await ghGetRepo(ctx)) : null;
    const body: any = { target, projectId, name: repoInfo?.name ?? undefined, gitSource: repoInfo ? { type: "github", repo: `${ctx.repo!.owner}/${ctx.repo!.repo}`, ref: String(ref ?? "main") } : undefined, force: true };
    const r = await netJson(`https://api.vercel.com/v13/deployments`, {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.vercelToken}`, "content-type": "application/json" },
      body: JSON.stringify(body), timeoutMs: 20000,
    });
    if (!r.ok || !r.body?.id) return `فشل بدء النشر (HTTP ${r.status}): ${r.body?.error?.message ?? r.body?.message ?? "؟"}`;
    const depId = r.body.id;
    const deadline = Date.now() + 45000;
    let state = r.body.readyState ?? "QUEUED";
    while (Date.now() < deadline && !["READY", "ERROR", "CANCELED"].includes(state)) {
      await new Promise((res) => setTimeout(res, 4000));
      const rr = await netJson(`https://api.vercel.com/v13/deployments/${encodeURIComponent(depId)}?projectId=${encodeURIComponent(projectId)}`, { headers: { authorization: `Bearer ${ctx.vercelToken}` } });
      if (rr.ok && rr.body) state = rr.body.readyState ?? rr.body.status ?? state;
    }
    return state === "READY"
      ? `نُشرت فعليًا إلى Vercel (${state}) — ${r.body.url ?? "url"} (deployment ${depId.slice(0, 12)}).`
      : `بدأ النشر في Vercel لكنه لم يصل READY خلال المهلة (آخر حالة ${state}) — تحقق من لوحة Vercel.`;
  }
  return `عملية موافقة غير معروفة (${action}) — لم تُنفَّذ.`;
}