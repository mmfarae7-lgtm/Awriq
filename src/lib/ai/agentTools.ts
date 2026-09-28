import type { AiToolDef } from './types'
import { readGithubFile, shouldShowPlain, type GithubRepoRef } from '../github'

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|php|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|css|scss|sass|html|sql|md|json|ya?ml|toml)$/
const HEAVY = /(node_modules|\/dist\/|\/build\/|\/vendor\/|package-lock|bootstrap-icons|\.min\.|\.lock$|\.gitkeep$)/
const MAX_RESULT = 12000

function rankPath(p: string): number {
  if (p.startsWith('config/')) return 0
  if (p.startsWith('api/') || p.startsWith('routes/')) return 1
  if (p.startsWith('includes/') || p.startsWith('includes/')) return 2
  if (p.startsWith('src/lib/')) return 3
  if (p.startsWith('lib/') || p.startsWith('src/')) return 3
  if (p.startsWith('modules/') || p.startsWith('src/pages/') || p.startsWith('src/components/')) return 4
  if (p.startsWith('sql/') || p.startsWith('migrations/')) return 5
  if (p.startsWith('assets/') || p.startsWith('public/') || p.startsWith('static/')) return 6
  return 7
}

function candidates(treePaths: string[], filter: (p: string) => boolean = () => true): string[] {
  return treePaths
    .filter((p) => CODE_EXT.test(p) && !HEAVY.test(p) && filter(p))
    .sort((a, b) => rankPath(a) - rankPath(b))
}

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s
  return s.slice(0, limit) + `\n… (اقتُطع: الإجمالي ${s.length} حرفًا)`
}

function masked(path: string): string {
  return `[محتوى محمي] الملف "${path}" يطابق نمط أسرار (env/secret/credential/password) ولا يُمرَّر للنموذج.`
}

function normalPath(p: string): string {
  const clean = String(p).trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!clean || clean.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return ''
  return clean
}

export { normalPath }

export const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['GitHub PAT', /\bghp_[A-Za-z0-9]{36,}\b/],
  ['OpenAI/Anthropic key', /\b(sk(-[A-Za-z0-9])?-|sk-ant-)[A-Za-z0-9_-]{16,}\b/],
  ['AWS Access Key', /\bAKIA[0-9A-Z]{16}\b/],
  ['AWS Secret', /\baws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{20,}["']?/i],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe key', /\bsk_live_[0-9a-zA-Z]{20,}\b/],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Postgres URL', /\bpostgres(ql)?:\/\/[^\s'"]+/i],
  ['Redis URL', /\brediss?:\/\/[^\s'"]+/i],
  ['Dodgy http auth', /\bhttps?:\/\/[^\s:@/]+:[^\s@/]+@/],
  ['Password field', /(password|passwd|pwd|db_password)\s*[:=]\s*["'][^"']{3,}["']/i],
  ['Secret/API field', /(secret|api_key|apikey|client_secret)\s*[:=]\s*["'][^"']{6,}["']/i],
  ['AWRIQ privacy token', /\bawriq_prj_[0-9a-f]{64}\b/],
]

function maskLine(line: string, re: RegExp): string {
  return line.replace(re, (m) => (m.length > 8 ? `${m.slice(0, 4)}…${m.slice(-2)}` : m))
}

export interface AgentToolCtx {
  repoRef: GithubRepoRef
  gitToken?: string
  treePaths: string[]
  onRead?: (path: string) => void
}

async function readOne(ctx: AgentToolCtx, path: string, maxChars: number): Promise<string> {
  if (!shouldShowPlain(path)) return masked(path)
  const c = await readGithubFile(ctx.repoRef, path)
  if (c === null) return `[تعذر قراءة الملف: ${path}]`
  ctx.onRead?.(path)
  return truncate(c, maxChars)
}

async function execReadFile(ctx: AgentToolCtx, args: { path: string; maxChars?: number }): Promise<string> {
  const path = normalPath(args?.path)
  if (!path || !ctx.treePaths.includes(path)) {
    if (!path) return '[read_file] المعامل path مطلوب.'
    return `[read_file] الملف "${path}" غير موجود في الشجرة.`
  }
  const c = await readOne(ctx, path, Math.min(args?.maxChars ?? 12000, 12000))
  return `=== ${path} ===\n${c}`
}

async function execReadMany(ctx: AgentToolCtx, args: { paths: string[] }): Promise<string> {
  const paths = (Array.isArray(args?.paths) ? args.paths.slice(0, 12) : []).map(normalPath).filter(Boolean)
  if (paths.length === 0) return '[read_many] حدد مسارات (paths[]) واحدة على الأقل بامتداد كود.'
  const out: string[] = []
  let budget = 60000
  for (const p of paths) {
    if (budget <= 0) { out.push(`… توقف عن قراءة الباقي (السقف ${'60k'} حرفًا وصل).`); break }
    let c: string
    if (!shouldShowPlain(p)) {
      c = masked(p)
    } else {
      const raw = await readGithubFile(ctx.repoRef, p)
      c = raw === null ? `[تعذر القراءة: ${p}]` : truncate(raw, Math.min(12000, budget))
      if (raw !== null) ctx.onRead?.(p)
    }
    out.push(`=== ${p} ===\n${c}`)
    budget -= c.length
  }
  return out.join('\n\n')
}

async function execListTree(ctx: AgentToolCtx, args: { dir?: string; limit?: number }): Promise<string> {
  const dir = String(args?.dir ?? '').trim().replace(/\/+$/, '')
  const limit = Math.min(Math.max(args?.limit ?? 400, 1), 1000)
  const all = dir
    ? ctx.treePaths.filter((p) => p === dir || p.startsWith(dir + '/'))
    : ctx.treePaths
  const sorted = all.slice().sort()
  const head = sorted.slice(0, limit)
  const tail = sorted.length > limit ? `\n… و${sorted.length - limit} مسارًا آخر` : ''
  return `شجرة (${sorted.length} مسارًا, مما يعرض أول ${limit}):\n${head.join('\n')}${tail}`
}

export function globToRegExp(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++ } else re += '[^/]*'
    } else if (ch === '?') re += '[^/]'
    else if ('\\^$+.()|{}[]'.includes(ch)) re += '\\' + ch
    else re += ch
  }
  return new RegExp('^' + re + '$')
}

async function execGlob(ctx: AgentToolCtx, args: { pattern: string; limit?: number }): Promise<string> {
  const pattern = String(args?.pattern ?? '')
  if (!pattern) return '[glob] المعامل pattern مطلوب (مثال: "src/**/*.ts").'
  let re: RegExp
  try { re = globToRegExp(pattern) } catch { return `[glob] نمط غير صالح: ${pattern}` }
  const match = ctx.treePaths.filter((p) => re.test(p)).sort()
  const limit = Math.min(args?.limit ?? 300, 500)
  const head = match.slice(0, limit)
  const tail = match.length > limit ? `\n… و${match.length - limit} آخر` : ''
  return `glob ${pattern}: ${match.length} تطابق:\n${head.join('\n')}${tail}`
}

async function extractMatches(text: string, query: string, maxLines: number): Promise<string[]> {
  const q = query.toLowerCase()
  const lines = text.split('\n')
  const hits: string[] = []
  for (let i = 0; i < lines.length && hits.length < maxLines; i++) {
    const line = lines[i]
    if (line.toLowerCase().includes(q)) hits.push(`${i + 1}: ${line.trim().slice(0, 220)}`)
  }
  return hits
}

async function execGrep(ctx: AgentToolCtx, args: { query: string; path?: string; limit?: number }): Promise<string> {
  const query = String(args?.query ?? '').trim()
  const pathFilter = normalPath(args?.path ?? '')
  if (!query) return '[grep] المعامل query مطلوب (نص أو regex بسيط).'
  const want = Math.min(args?.limit ?? 20, 40)

  const repoPath = (p: string): string | null => {
    if (!normalPath(p) || !ctx.treePaths.includes(normalPath(p))) return null
    return normalPath(p)
  }

  if (ctx.gitToken) {
    try {
      const q = `${query} repo:${ctx.repoRef.owner}/${ctx.repoRef.repo}${pathFilter ? ` path:${pathFilter}` : ''}`
      const res = await fetch(
        `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${Math.min(want * 2, 40)}`,
        { headers: { authorization: `Bearer ${ctx.gitToken}`, accept: 'application/vnd.github+json', 'user-agent': 'AWRIQ-Agent/1.0' } },
      )
      if (res.ok) {
        const data = await res.json()
        const paths = (data.items ?? []).map((i: { path: string }) => i.path).filter(shouldShowPlain).slice(0, want)
        if (paths.length === 0) return `[grep] لا نتائج بحث عبر GitHub لـ "${query}"${pathFilter ? ` في ${pathFilter}` : ''}.`
        const parts: string[] = [`بحث GitHub لـ "${query}"${pathFilter ? ` (المسار ${pathFilter})` : ''}: ${paths.length} ملف — جلب حلًّا للمطابقات:`]
        let budgetLeft = MAX_RESULT
        for (const p of paths) {
          if (budgetLeft <= 0) break
          const safe = repoPath(p)
          if (!safe) continue
          const raw = await readGithubFile(ctx.repoRef, safe)
          if (raw === null) continue
          ctx.onRead?.(p)
          const hits = await extractMatches(raw, query.slice(0, 120), 3)
          if (hits.length === 0) continue
          const block = `\n--- ${p} ---\n` + hits.join('\n')
          parts.push(block)
          budgetLeft -= block.length
        }
        return truncate(parts.join('\n'), MAX_RESULT)
      }
      if (res.status === 401 || res.status === 403) {
        return `[grep] بحث GitHub رفض التوكن (${res.status}). أنتقل للبحث المحلي المحدود.`
      }
    } catch {
      /* fall through to local scan */
    }
  }

  const pool = candidates(ctx.treePaths, (p) => (pathFilter ? p.startsWith(pathFilter + '/') || p.startsWith(pathFilter) : true)).slice(0, 60)
  const hits: string[] = []
  let scanned = 0
  for (const p of pool) {
    if (hits.length >= want) break
    if (!shouldShowPlain(p)) continue
    if (!ctx.treePaths.includes(p)) continue
    try {
      const raw = await readGithubFile(ctx.repoRef, p)
      if (raw === null) continue
      scanned++
      ctx.onRead?.(p)
      const m = await extractMatches(raw, query.slice(0, 120), 3)
      for (const line of m) hits.push(`${p}:${line}`)
    } catch { /* skip */ }
  }
  const message = hits.length
    ? truncate(hits.slice(0, want).join('\n'), MAX_RESULT)
    : `لا نتائج ${scanned === 0 ? '(لم يُعثر على ملفات قابلة للمسح)' : `بين ${scanned} ملفًا مفحوصًا`}.`
  return `grep محلي "${query}"${pathFilter ? ` (${pathFilter})` : ''}: ${message}`
}

async function execReadCodebase(ctx: AgentToolCtx, args: { maxChars?: number; pin?: string[] }): Promise<string> {
  const budget = Math.min(Math.max(args?.maxChars ?? 120000, 10000), 220000)
  const pinned = (Array.isArray(args?.pin) ? args.pin.map(normalPath).filter(Boolean) : []).slice(0, 8)
  const ordered = [...pinned, ...candidates(ctx.treePaths)]
  const out: string[] = []
  let used = 0
  const seen = new Set<string>()
  for (const p of ordered) {
    if (seen.has(p)) continue
    seen.add(p)
    if (!ctx.treePaths.includes(p)) continue
    if (used >= budget) break
    if (!shouldShowPlain(p)) { out.push(`=== ${p} ===\n${masked(p)}`); continue }
    try {
      const raw = await readGithubFile(ctx.repoRef, p)
      if (raw === null) continue
      ctx.onRead?.(p)
      const c = truncate(raw, Math.min(15000, budget - used))
      const block = `=== ${p} (${c.length} حرفًا) ===\n${c}`
      out.push(block)
      used += c.length
    } catch { /* skip */ }
    if (out.length > 120) break
  }
  return `قرأت ${seen.size} ملفًا كوديًا مما أدرج في السياق، ${used.toLocaleString('en')} حرفًا (السقف ${budget.toLocaleString('en')}). ترتيب الأولوية: config → api → includes → lib → modules → pages → sql. الرجاء الاعتماد على ما قُرئ فعلًا فقط، وعدم الادعاء بمراجعة ملفات غير مدرجة أدناه.\n\n${out.join('\n\n')}`
}

export const AGENT_TOOLS: AiToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'scan_secrets',
      description: 'يمسح الكود بحثًا عن أسرار مُخزّنة (مفاتيح، توكنات، كلمات مرور، روابط DB) ويعرض المواضع مع إخفاء القيمة الفعلية. للمراجعة الأمنية',
      parameters: {
        type: 'object',
        properties: { files: { type: 'number', description: 'عدد الملفات للمسح (افتراضي 120)' }, maxHits: { type: 'number', description: 'سقف المؤشرات (افتراضي 200)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: 'سجل الالتزامات من GitHub لآخر الأيام (خيارياً لمسار/مجلد واحد). استخدمه للتحقق من أن "تعديلاً" حدث فعلاً قبل الادعاء به.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'مسار أو مجلد اختياري للتقاطر إليه (مثال: src/lib/auth.tsx)' },
          days: { type: 'number', description: 'عدد الأيام خلال الخلف (افتراضي 30)' },
          limit: { type: 'number', description: 'أقصى عدد من الالتزامات (افتراضي 15)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tree',
      description: 'يسرد مسارات الملفات في شجرة المستودع (خيارياً داخل مجلد). استخدمه أولاً لفهم البنية.',
      parameters: {
        type: 'object',
        properties: { dir: { type: 'string', description: 'مجلد اختياري للحد من النتائج (مثال: src/lib)' }, limit: { type: 'number', description: 'أقصى عدد (افتراضي 400)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'يقرأ ملفًا كاملًا من المستودع (حتى 12000 حرف). الملفات الحساسة (env/secret/password) مقيّدة.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, maxChars: { type: 'number' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_many',
      description: 'يقرأ عدة ملفات دفعة واحدة (حتى 12) بإجمالي حتى 60000 حرف. مناسب لقراءة ملفات مترابطة (يحتوي صفحة + سيرفرتك + مكتبة).',
      parameters: {
        type: 'object',
        properties: { paths: { type: 'array', items: { type: 'string' } } },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'يبحث في محتوى الكود عن نص (مثل DB_HOST أو password أو vulnerable). يستخدم بحث GitHub الكامل إن وجد توكن في تبويب Git وإلا فمسح محلي محدود بـ 60 ملفًا. امنع النتائج الحساسة.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, path: { type: 'string', description: 'تقييد البحث ضمن مسار معين' }, limit: { type: 'number' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'يطابق مسارات الملفات بنمط wildcard (مثال "src/**/*.ts" أو "config/*.php").',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' }, limit: { type: 'number' } },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_codebase',
      description: 'للمراجعة الشاملة: يقرأ سياق الكود الأساسي كله (حتى 120000 حرف) بترتيب أولوية config/api/includes/lib/modules/pages. استدعه مرة واحدة عند طلب فحص شامل، ثم ركّز بأدوات أدق (read_file/grep) على المناطق عالية الخطورة المحددة.',
      parameters: {
        type: 'object',
        properties: { maxChars: { type: 'number' }, pin: { type: 'array', items: { type: 'string' }, description: 'مسارات تفرضها في المقدمة' } },
      },
    },
  },
]

async function execScanSecrets(ctx: AgentToolCtx, args: { files?: number; maxHits?: number }): Promise<string> {
  const files = Math.min(Math.max(args?.files ?? 120, 1), 300)
  const maxHits = Math.min(Math.max(args?.maxHits ?? 200, 1), 800)
  const pool = candidates(ctx.treePaths).slice(0, files)
  const report: string[] = []
  let scanned = 0
  let totalHits = 0
  for (const p of pool) {
    if (totalHits >= maxHits) break
    try {
      const raw = await readGithubFile(ctx.repoRef, p)
      if (raw === null) continue
      scanned++
      ctx.onRead?.(p)
      const hits: string[] = []
      const lines = raw.split('\n')
      for (let i = 0; i < lines.length && hits.length < 8; i++) {
        for (const [label, re] of SECRET_PATTERNS) {
          if (!re.test(lines[i])) continue
          hits.push(`سطر ${i + 1} [${label}]: ${maskLine(lines[i].trim().slice(0, 140), re)}`)
          totalHits++
          break
        }
      }
      if (hits.length > 0) report.push(`=== ${p} ===\n${hits.join('\n')}`)
    } catch { /* skip */ }
  }
  if (report.length === 0) {
    return `[scan_secrets] لا أسرار مكتشفة ضمن ${scanned} ملفًا مفحوصًا (قاعدة: الأنماط أعلاه + قيم مُخفاة). لاحظ أنّ المسح يغطي النمط السطحي فقط.`
  }
  return `فحص أسرار: ${scanned} ملفًا، ${totalHits} مؤشرًا ضمن ${report.length} ملفًا (القيم مُخفاة):\n\n${report.join('\n\n')}`
}

async function execGitLog(ctx: AgentToolCtx, args: { path?: string; days?: number; limit?: number }): Promise<string> {
  const { repoRef } = ctx
  const days = Math.min(Math.max(args.days ?? 30, 1), 365)
  const limit = Math.min(Math.max(args.limit ?? 15, 1), 30)
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const q = new URLSearchParams({ sha: repoRef.branch, since, per_page: String(limit), ...(args.path ? { path: args.path } : {}) })
  const url = `https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}/commits?${q}`

  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', ...(ctx.gitToken ? { Authorization: `Bearer ${ctx.gitToken}` } : {}) } })
  if (!res.ok) return `[git_log] فشل جلب الالتزامات (${res.status})${res.status === 404 ? ': تحقق من أن المستودع/الفرع صحيح وللوصول الخاص أضف توكن' : ''}`
  const list = (await res.json()) as Array<{ sha: string; commit: { message: string; committer: { date: string } } }>
  if (list.length === 0) return '[git_log] لا التزامات في هذه الفترة.'
  return list
    .map((c) => `• ${c.commit.committer.date.slice(0, 10)} ${c.sha.slice(0, 8)} ${c.commit.message.split('\n')[0].slice(0, 90)}`)
    .join('\n')
}

export async function execAgentTool(name: string, rawArgs: string, ctx: AgentToolCtx): Promise<{ ok: boolean; output: string }> {
  let args: Record<string, unknown> = {}
  if (rawArgs && rawArgs.trim()) {
    try { args = JSON.parse(rawArgs) as Record<string, unknown> } catch { return { ok: false, output: `[أداة] وسيطات JSON غير صالحة: ${rawArgs.slice(0, 120)}` } }
  }
  try {
    switch (name) {
      case 'list_tree': return { ok: true, output: await execListTree(ctx, args as { dir?: string; limit?: number }) }
      case 'scan_secrets': return { ok: true, output: await execScanSecrets(ctx, args as { files?: number; maxHits?: number }) }
      case 'git_log': return { ok: true, output: await execGitLog(ctx, args as { path?: string; days?: number; limit?: number }) }
      case 'glob': return { ok: true, output: await execGlob(ctx, args as { pattern: string; limit?: number }) }
      case 'read_file': return { ok: true, output: await execReadFile(ctx, args as { path: string; maxChars?: number }) }
      case 'read_many': return { ok: true, output: await execReadMany(ctx, args as { paths: string[] }) }
      case 'grep': return { ok: true, output: await execGrep(ctx, args as { query: string; path?: string; limit?: number }) }
      case 'read_codebase': return { ok: true, output: await execReadCodebase(ctx, args as { maxChars?: number; pin?: string[] }) }
      default: return { ok: false, output: `أداة غير معروفة: ${name}` }
    }
  } catch (err) {
    return { ok: false, output: `[أداة ${name}] فشل التنفيذ: ${err instanceof Error ? err.message : String(err)}` }
  }
}