import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Bot, Send, FolderGit2, FileCode, Terminal, GitBranch, CheckCircle,
  AlertTriangle, Shield, Activity, StopCircle, Loader,
  Folder, FileText, Lock, Cpu, Bug, KeyRound,
  ArrowRight, Loader2, RefreshCw, GitMerge, ExternalLink, GitCommitHorizontal,
  Save, XCircle, Check, Search, Wrench, Settings, GitPullRequest, Server, Database, Copy, Play,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import { aiGateway } from '../lib/ai'
import type { AIModel, AIProvider, AiToolCall, ChatMessage as LlmMessage } from '../lib/ai'
import { runServerAgent, approveServerApproval, type AgentServerMode } from '../lib/ai/agentServer'
import { AGENT_TOOLS, execAgentTool } from '../lib/ai/agentTools'
import {
  parseGithubUrl, listGithubTree, readGithubFile, shouldShowPlain, commitGithubFiles,
  dispatchAwriqWorkflow, latestWorkflowRun,
  type GithubRepoRef, type GithubTreeItem, type GithubWritePatch,
} from '../lib/github'
import { buildLineDiff, diffStats } from '../lib/diff'
import type { Project, Institution, AgentSession, AgentTask, AgentApproval } from '../types'
import { formatRelativeTime, formatCountdown } from '../lib/utils'
import AccessTokensPage from './AccessTokensPage'
import ProjectAccessPage from './ProjectAccessPage'
import AIProvidersPage from './AIProvidersPage'
import SecurityPage from './SecurityPage'
import SupportPage from './SupportPage'

interface AgentFileChange {
  id: string
  session_id: string
  project_id: string
  file_path: string
  change_type: 'create' | 'modify' | 'delete'
  diff: string | null
  old_content: string | null
  new_content: string | null
  is_approved: boolean | null
  is_applied: boolean
  approval_id: string | null
  commit_sha: string | null
  created_at: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  actions?: string[]
  files?: string[]
  provider?: string
  model?: string
  timestamp: string
}

type TabKey = 'chat' | 'files' | 'terminal' | 'diff' | 'logs' | 'tasks' | 'git' | 'access' | 'settings'
type AgentMode = 'read_only' | 'analyze' | 'fix_with_approval' | 'full_development' | 'emergency'

const modeLabels: Record<AgentMode, string> = {
  read_only: 'قراءة فقط', analyze: 'تحليل', fix_with_approval: 'إصلاح بموافقة',
  full_development: 'تطوير كامل', emergency: 'طوارئ',
}

const writeModes: AgentMode[] = ['fix_with_approval', 'full_development', 'emergency']

const serverModeFor = (m: AgentMode): AgentServerMode => (m === 'read_only' ? 'read' : m === 'analyze' ? 'plan' : 'edit_approval')

const statusLabels: Record<string, string> = {
  idle: 'خامل', connecting: 'جاري الاتصال', analyzing: 'جاري التحليل', working: 'يعمل',
  testing: 'جاري الاختبار', waiting_approval: 'بانتظار الموافقة', deploying: 'جاري النشر',
  completed: 'مكتمل', failed: 'فشل', stopped: 'متوقف',
}
const statusColors: Record<string, string> = {
  idle: '#68727A', connecting: '#C58A3A', analyzing: '#C89B5A', working: '#8A5A2B',
  testing: '#C89B5A', waiting_approval: '#C58A3A', deploying: '#C94B4B',
  completed: '#4F8A5B', failed: '#C94B4B', stopped: '#68727A',
}

const SYSTEM_PROMPT = `أنت وكيل برمجي في غرفة صيانة مشروع عن بُعد — تعمل بأسلوب opencode: أنت من يقرر بنفسك ما يقرأه وما يبحث عنه، عبر أدوات القراءة المتاحة (list_tree, read_file, read_many, grep, glob, read_codebase, git_log).
القاعدة الذهبية: لا تشكّل استنتاجات عن ملفات لم تقرأها، ولا تدّعِ أنك راجعت ملفًا غير مدرج في نتائج أدواتك. اذكر دائمًا نطاق ما فحصته فعلاً.
قاعدة الصدق حول التعديلات: لا تصف أي شيء بصيغة الماضي (تم/أُضيف/أُصلح/طُبّق) إلا إذا رأيت الدليل بنفسك في نتائج أدواتك. إن زُعم لك أن هناك "تعديلات طُبّقت" في مشروع، فاستدعِ git_log (مع النطاق الزمني والتوم بالقدر المناسب) و/أو read_file المباشر قبل الحكم، واذكر لكل بند: (أ) ملاحظ في الكود مع الملف والسطر، أو (ب) سجل الالتزامات يثبته + التاريخ، أو (ج) غير موجود — وقل ذلك صراحةً واكتبه كتوصية لا كواقع منفَّذ.
خط سير الفحص الشامل ("افحص المشروع بشكل شامل"):
  1) استدعِ list_tree لفهم البنية ثم read_codebase لتحميل عمود الفقري (config → api → includes → lib → modules → pages).
  2) ركّز على المناطق عالية الخطورة: المصادقة، الصلاحيات، قاعدة البيانات (مفاتيح/استعلامات)، رفع الملفات، العرض (XSS)، الأسرار المضمنة.
  3) استعمل grep للبحث عن أنماط خطرة (password, token, api_key, secret, exec, eval, die, mysql, $_GET, innerHTML, dangerouslySetInnerHTML...).
  4) استعمل read_file/read_many للتعمق في الملفات التي تطابقت أو التي تدير المسارات الحرجة.
  5) أعد تقريرًا مرقّمًا مرتبًا بالأولوية (حرج/عالي/متوسط/منخفض) مع اسم الملف ورقم السطر، وخلاصة عامة، واقتراحات الإصلاح.
تفاعل: أنت تجيب بالعربية؛ لا تعدّل ملفات مباشرة — الاقتراحات تنتقل عبر أدوات تحرير الواجهة (اقتراح/عدّل/احذف) ويلزم موافقة المستخدم قبل أي تطبيق على GitHub.
توقّف العمل بالأدوات حالما تجمع ما يكفي للإجابة، ولا كرر قراءة الملفات نفسها.`

interface TurnTool {
  id: string
  name: string
  status: 'running' | 'ok' | 'error'
  summary?: string
}

interface TreeNode {
  name: string
  type: 'folder' | 'file'
  path: string
  children?: TreeNode[]
}

function nestedTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const p of paths) {
    const parts = p.split('/')
    let level = root
    let acc = ''
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part
      const isFile = i === parts.length - 1
      const existing = level.find((n) => n.name === part)
      if (existing) {
        if (!isFile) level = existing.children ??= []
      } else {
        const node: TreeNode = { name: part, type: isFile ? 'file' : 'folder', path: acc, ...(isFile ? {} : { children: [] }) }
        level.push(node)
        if (!isFile) level = node.children as TreeNode[]
      }
    })
  }
  return root
}

const LLM_BUDGET = 240_000

const WORKFLOW_TEMPLATE = `name: awriq-run
on:
  workflow_dispatch:
    inputs:
      command:
        description: 'الأمر المراد تنفيذه (مثال: npm run build أو php artisan test)'
        required: true
        type: string

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Execute
        run: |
          set -o pipefail
          ${'${{ github.event.inputs.command }}'}
      - name: Report exit
        run: echo "AWRIQ_EXIT=$?" >> "$GITHUB_ENV"`

function summarizeToolResult(output: string): string {
  const first = output.split('\n').find(l => l.trim()) ?? ''
  if (/\[\w[\w_-]*\]/.test(first)) {
    const tag = first.match(/\[([^\]]+)\]/)?.[1] ?? ''
    const rest = first.slice(first.indexOf(']') + 1).trim().slice(0, 60)
    return rest ? `${tag}: ${rest}` : tag
  }
  return first.slice(0, 80).replace(/`/g, '')
}

function trimToolHistory(msgs: LlmMessage[]): LlmMessage[] {
  const sizeOf = (m: LlmMessage) => m.content.length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0)
  const estimate = (arr: LlmMessage[]) => arr.reduce((a, m) => a + sizeOf(m), 0)
  if (estimate(msgs) <= LLM_BUDGET) return msgs
  const groups: LlmMessage[][] = []
  let current: LlmMessage[] = []
  for (const m of msgs) {
    if (m.role === 'assistant' && m.tool_calls && current.length > 0) {
      groups.push(current)
      current = [m]
    } else {
      current.push(m)
    }
  }
  if (current.length > 0) groups.push(current)
  if (groups.length <= 2) return msgs
  let kept = groups[0]
  let total = estimate(kept)
  for (let g = 1; g < groups.length; g++) {
    const s = estimate(groups[g])
    if (total + s > LLM_BUDGET && g > 1) {
      return [...kept, { role: 'system', content: 'خلاصة سياق: حُذفت جولات أدوات أقدم لتوفير المساحة — ركّز على الأحدث وأكمل عملك.' }, ...groups.slice(g).flat()]
    }
    total += s
    kept = kept.concat(groups[g])
  }
  return msgs
}

export default function AgentRoomPage() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { session: authSession } = useAuth()
  const [projects, setProjects] = useState<(Project & { institutions: Institution })[]>([])
  const [selectedProject, setSelectedProject] = useState<(Project & { institutions: Institution }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null)
  const [mode, setMode] = useState<AgentMode>('read_only')
  const [agentStatus, setAgentStatus] = useState<string>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('chat')
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [approvals, setApprovals] = useState<AgentApproval[]>([])
  const [terminalOutput, setTerminalOutput] = useState<{ command: string; output: string; exitCode: number | null }[]>([])
  const [logs, setLogs] = useState<{ level: string; message: string; timestamp: string }[]>([])

  // AI providers/models
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [models, setModels] = useState<AIModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [engine, setEngine] = useState<'server' | 'client'>(() => (localStorage.getItem('awriq_room_engine') === 'client' ? 'client' : 'server'))
  const [streaming, setStreaming] = useState(false)
  const [turnTools, setTurnTools] = useState<TurnTool[]>([])
  const [iterationLabel, setIterationLabel] = useState<string>('')
  const abortRef = useRef<AbortController | null>(null)

  const [repoRef, setRepoRef] = useState<GithubRepoRef | null>(null)
  const [treePaths, setTreePaths] = useState<string[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileProtected, setFileProtected] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)

  // M3 write-tools state
  const [fileChanges, setFileChanges] = useState<AgentFileChange[]>([])
  const [gitToken, setGitToken] = useState<string>('')
  const [draftContent, setDraftContent] = useState<string | null>(null)
  const [commitBusy, setCommitBusy] = useState(false)
  const [githubOk, setGithubOk] = useState<boolean | null>(null)
  const [integrations, setIntegrations] = useState<{ kind: string; is_connected: boolean; provider_ref: string | null; token_prefix: string | null }[]>([])
  const [runCmd, setRunCmd] = useState('')
  const [runBusy, setRunBusy] = useState(false)

  const loadProjects = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('projects').select('*, institutions(*)').eq('is_active', true).order('created_at', { ascending: false })
    if (data) setProjects(data as (Project & { institutions: Institution })[])
    setLoading(false)
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  const [searchParams] = useSearchParams()
  useEffect(() => {
    const pid = searchParams.get('project')
    if (!pid || selectedProject || projects.length === 0) return
    const match = projects.find(pr => pr.id === pid)
    if (match) void openProject(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, projects, selectedProject])

  const chatListRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = chatListRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  useEffect(() => {
    const el = composerRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 220)}px`
    }
  }, [input])

  const addLog = useCallback((level: string, message: string) => {
    setLogs(prev => [...prev, { level, message, timestamp: new Date().toISOString() }])
  }, [])

  const upsertChip = (tool: { id: string; name: string }) => {
    setTurnTools(prev => prev.some(t => t.id === tool.id) ? prev : [...prev, { id: tool.id, name: tool.name, status: 'running' }])
  }

  const settleChip = (id: string, ok: boolean, summary?: string) => {
    setTurnTools(prev => prev.map(t => t.id === id ? { ...t, status: ok ? 'ok' : 'error', summary } : t))
  }

  const addMessage = (role: 'user' | 'agent' | 'system', content: string, extra?: { actions?: string[]; files?: string[]; provider?: string; model?: string }) => {
    setMessages(prev => [...prev, { id: Date.now().toString() + Math.random(), role, content, timestamp: new Date().toISOString(), ...extra }])
  }

  async function persistMessage(sessionId: string, sender: 'user' | 'agent' | 'system', content: string, meta?: { attachments?: string[]; actions?: string[]; provider?: string; model?: string; modelId?: string }) {
    const { error } = await supabase.from('agent_messages').insert({
      session_id: sessionId,
      sender,
      content,
      attachments: meta?.attachments ?? [],
      role_meta: meta ? { actions: meta.actions ?? [], provider: meta.provider, model: meta.model } : {},
      model_id: meta?.modelId ?? null,
    })
    if (error) addLog('error', `agent_messages insert: ${error.message}`)
  }

  const openProject = async (project: Project & { institutions: Institution }) => {
    setSelectedProject(project)
    setAgentStatus('connecting')
    setMessages([])
    setTasks([])
    setApprovals([])
    setTerminalOutput([])
    setLogs([])
    setTreePaths([])
    setSelectedFilePath(null)
    setFileContent(null)
    setFileProtected(false)
    setStreaming(false)
    setTurnTools([])
    setIterationLabel('')
    setGithubOk(null)
    setIntegrations([])
    abortRef.current?.abort()

    const { data: intData } = await supabase.from('project_integrations').select('kind, provider_ref, is_connected, token_prefix').eq('project_id', project.id)
    if (intData) setIntegrations(intData as typeof integrations)

    const res = parseGithubUrl(project.repository_url || '')
    setRepoRef(res)

    const { data: sessData, error } = await supabase.from('agent_sessions').insert({
      user_id: authSession?.user?.id,
      project_id: project.id,
      mode,
      status: 'idle',
      permissions: {},
    }).select('*').single()

    if (error) {
      showToast('فشل إنشاء جلسة الوكيل: ' + error.message, 'error')
      setAgentStatus('idle')
      return
    }

    setAgentSession(sessData as AgentSession)
    setAgentStatus('idle')

    // Load pending file changes + approvals for this session
    await Promise.all([
      loadFileChanges(sessData.id),
      loadApprovals(sessData.id),
    ])

    // Load AI catalog
    await aiGateway.loadFromDb()
    setProviders(aiGateway.getProviders())
    setModels(aiGateway.getModels())
    setSelectedModelId('')

    const systemMsg = `تم الاتصال بالمشروع: ${project.name}\n${res ? `المستودع: ${res.owner}/${res.repo} (${res.branch})` : 'لم يُربط مستودع GitHub بعد.'}\nالمؤسسة: ${project.institutions?.name_ar || project.institutions?.name || '—'}\nالوضع: ${modeLabels[mode]}\nالوكيل جاهز لاستقبال المهام.`
    addMessage('system', systemMsg)
    await persistMessage(sessData.id, 'system', systemMsg)
    addLog('info', `Agent session started for project: ${project.name}`)

    if (res) void loadTree(res, project.id)

    await supabase.from('activity_logs').insert({
      action: 'agent_session_started', resource: 'agent_session',
      resource_id: sessData.id, details: `فتح غرفة الوكيل للمشروع: ${project.name}`,
    })
  }

  const loadTree = async (ref: GithubRepoRef, projectId: string) => {
    setTreeLoading(true)
    setGithubOk(null)
    try {
      const items = await listGithubTree(ref)
      const blobs = items.filter((i): i is GithubTreeItem & { type: 'blob' } => i.type === 'blob').map(i => i.path)
      setTreePaths(blobs)
      setGithubOk(true)
      await supabase.from('activity_logs').insert({
        action: 'agent_read', resource: 'git_tree',
        details: `قراءة شجرة المستودع ${ref.owner}/${ref.repo} (${blobs.length} ملف)`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setGithubOk(false)
      addLog('error', `loadTree: ${msg}`)
      showToast(msg, 'error')
    } finally {
      setTreeLoading(false)
      void projectId
    }
  }

  const openFile = async (path: string) => {
    if (!repoRef) return
    setSelectedFilePath(path)
    setFileContent(null)
    setFileProtected(false)
    const plain = shouldShowPlain(path)
    setFileProtected(!plain)
    if (plain) {
      setFileLoading(true)
      try {
        const content = await readGithubFile(repoRef, path)
        setFileContent(content)
        await supabase.from('activity_logs').insert({
          action: 'agent_read', resource: 'file',
          details: `قراءة ملف: ${path}`,
        })
      } catch {
        setFileContent('') 
      } finally {
        setFileLoading(false)
      }
    }
  }

  const loadFileChanges = async (sessionId: string) => {
    const { data } = await supabase.from('agent_file_changes').select('*').eq('session_id', sessionId).order('created_at', { ascending: false })
    if (data) setFileChanges(data as AgentFileChange[])
  }

  const loadApprovals = async (sessionId: string) => {
    await supabase.rpc('expire_stale_approvals')
    const pid = selectedProject?.id ?? null
    const { data } = await supabase
      .from('agent_approvals')
      .select('*')
      .or(pid ? `session_id.eq.${sessionId},project_id.eq.${pid}` : `session_id.eq.${sessionId}`)
      .order('created_at', { ascending: false })
    if (data) setApprovals(data as AgentApproval[])
  }

  const refreshChanges = async () => {
    if (!agentSession) return
    await Promise.all([loadFileChanges(agentSession.id), loadApprovals(agentSession.id)])
  }

  /** Stage a raw edit. A `file_modify` approval is created; no remote change yet. */
  const proposeFileEdit = async (path: string, newContent: string, changeType: 'create' | 'modify' | 'delete') => {
    if (!agentSession || !repoRef || !authSession?.user?.id) return
    const oldContent = changeType === 'delete' ? fileContent : (fileContent ?? '')
    if (changeType === 'modify' && oldContent === newContent) {
      showToast('لا تغيير في المحتوى — ألغِ الاقتراح.', 'warning')
      return
    }

    const risk = changeType === 'delete' ? 'high' : 'medium'
    const { data: approval, error: aerr } = await supabase.from('agent_approvals').insert({
      session_id: agentSession.id,
      user_id: authSession.user.id,
      action_type: changeType === 'delete' ? 'file_delete' : 'file_modify',
      description: `${changeType === 'delete' ? 'حذف' : 'تعديل'} الملف ${path}`,
      risk_level: risk,
      files_affected: [path],
      status: 'pending',
    }).select('*').single()
    if (aerr) { showToast('فشل إنشاء طلب الموافقة: ' + aerr.message, 'error'); return }

    const { error: cerr } = await supabase.from('agent_file_changes').insert({
      session_id: agentSession.id,
      project_id: selectedProject!.id,
      file_path: path,
      change_type: changeType,
      old_content: oldContent,
      new_content: changeType === 'delete' ? null : newContent,
      is_approved: false,
      is_applied: false,
      approval_id: (approval as { id: string }).id,
    }).select('*').single()
    if (cerr) { showToast('فشل تسجيل التغيير: ' + cerr.message, 'error'); return }

    await Promise.all([loadFileChanges(agentSession.id), loadApprovals(agentSession.id)])
    addLog('info', `Staged ${changeType} for ${path} (approval ${(approval as { id: string }).id})`)
    setDraftContent(null)
    setFileContent(newContent)
    showToast('سُجّل التغيير المقترح — وافق عليه من تبويب Git أو البيانات الجانبية.', 'success')
  }

  /** Review an approval. On approve of a file change, apply it as a GitHub commit. */
  const reviewApproval = async (approval: AgentApproval, approve: boolean) => {
    if (!agentSession || !authSession?.user?.id || !repoRef) return
    const status = approve ? 'approved' : 'rejected'

    // Server-created approvals carry a `payload`; delegation runs apply + mark inside awriq-agent.
    if ((approval as unknown as { payload?: unknown }).payload) {
      if (!approve) {
        const { error } = await supabase.from('agent_approvals').update({ status, reviewed_by: authSession.user.id, reviewed_at: new Date().toISOString() }).eq('id', approval.id)
        if (error) showToast('فشل تحديث الموافقة: ' + error.message, 'error')
        await refreshChanges()
        return
      }
      setCommitBusy(true)
      try {
        const res = await approveServerApproval({ project_id: selectedProject!.id, approval_id: approval.id, mode: serverModeFor(mode) })
        if (!res.ok) throw new Error(res.message ?? 'فشل تطبيق الموافقة')
        addLog('info', `تطبيق موافقة الخادم ${approval.id.slice(0, 8)} عبر awriq-agent`)
        showToast('نُفّذ التعديل المعتمَد من الخادم', 'success')
        if (repoRef.branch === 'HEAD') void loadTree(repoRef, selectedProject!.id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        addLog('error', `apply server approval: ${msg}`)
        showToast('فشل تطبيق التغييرات: ' + msg, 'error')
      } finally {
        setCommitBusy(false)
        await refreshChanges()
      }
      return
    }

    const { error } = await supabase
      .from('agent_approvals')
      .update({ status, reviewed_by: authSession.user.id, reviewed_at: new Date().toISOString() })
      .eq('id', approval.id)
    if (error) { showToast('فشل تحديث الموافقة: ' + error.message, 'error'); return }

    if (!approve) { await refreshChanges(); return }

    addLog('info', `Approval ${approval.id} approved — applying staged changes`)
    setCommitBusy(true)
    try {
      const pending = fileChanges.filter(fc => fc.approval_id === approval.id && !fc.is_applied)
      if (pending.length > 0) {
        const patches: GithubWritePatch[] = pending
          .filter(fc => fc.change_type !== 'delete')
          .map(fc => ({ path: fc.file_path, content: fc.new_content ?? '' }))
        let commitSha: string | null = null
        if (patches.length > 0) {
          if (!gitToken) throw new Error('أدخل توكن GitHub أولاً (تبويب Git) لتنفيذ الالتزام.')
          const res = await commitGithubFiles(repoRef, gitToken, patches, `AWRIQ: ${approval.description}`)
          commitSha = res.commitSha
        }
        await supabase.from('agent_file_changes').update({ is_approved: true, is_applied: true, commit_sha: commitSha }).eq('approval_id', approval.id)
        await Promise.all([loadFileChanges(agentSession.id), loadApprovals(agentSession.id)])
        addLog('info', `Applied ${pending.length} file change(s)${commitSha ? ` @ ${commitSha.slice(0, 7)}` : ''}`)
        showToast(`تم تطبيق ${pending.length} تغيير${commitSha ? ' ونشرها إلى GitHub' : ' (حذف فقط)'}`, 'success')
        if (repoRef.branch === 'HEAD') {
          void loadTree(repoRef, selectedProject!.id)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog('error', `apply approved changes: ${msg}`)
      showToast('فشل تطبيق التغييرات: ' + msg, 'error')
      await supabase.from('agent_approvals').update({ status, reviewed_at: null }).eq('id', approval.id)
    } finally {
      setCommitBusy(false)
      await refreshChanges()
    }
  }

  const reviewAllApprovals = async (approve: boolean) => {
    const pend = approvals.filter(a => a.status === 'pending')
    for (const a of pend) await reviewApproval(a, approve)
    showToast(approve ? 'تمت الموافقة على الكل' : 'تم رفض الكل', 'success')
  }

  const sendMessage = async (overrideText?: string) => {
    const userText = (overrideText ?? input).trim()
    if (!userText || !agentSession || !selectedProject) return
    setInput('')
    addMessage('user', userText, { files: undefined })
    await persistMessage(agentSession.id, 'user', userText)
    setAgentStatus('analyzing')
    setStreaming(true)
    setTurnTools([])
    setIterationLabel('')

    abortRef.current = new AbortController()
    const signal = abortRef.current.signal

    try {
      const readFilesSet = new Set<string>()
      const treeNote = treePaths.length > 0
        ? `الشجرة محمّلة (${treePaths.length} مسارًا) — استكشفها بـ list_tree/glob.`
        : repoRef
          ? 'الشجرة غير محمّلة بعد — استدعِ list_tree. إن رفضت، قد يكون المستودع خاصًا (تحتاج توكن في تبويب Git).'
          : 'لم يُربط مستودع GitHub — لا تتوفر أدوات قراءة.'

      const history: LlmMessage[] = [
        {
          role: 'system',
          content: `${SYSTEM_PROMPT}\n\nالمشروع: ${selectedProject.name} (${repoRef ? `${repoRef.owner}/${repoRef.repo}@${repoRef.branch}` : 'بدون مستودع'}) — ${treeNote}`,
        },
        ...messages.slice(-10).map(m => ({
          role: (m.role === 'agent' ? 'assistant' : m.role) as 'system' | 'user' | 'assistant',
          content: (m.provider ? `[${m.provider}/${m.model}] ` : '') + m.content,
        })),
        { role: 'user', content: userText },
      ]

      let llm = [...history]
      let fullText = ''
      let usedProvider = ''
      let usedModel = ''
      let anyCut = false

      // The single agent bubble for this turn, updated live while streaming.
      const agentMsg: { id: string; role: 'agent'; content: string; timestamp: string; actions: string[]; files: string[] } = {
        id: 'agent-turn-' + Date.now() + '-' + Math.random(),
        role: 'agent',
        content: '…',
        timestamp: new Date().toISOString(),
        actions: ['file_search', 'file_read'],
        files: [],
      }
      setMessages(prev => [...prev, agentMsg])
      const updateBubble = (text: string) => {
        setMessages(prev => prev.map(m => m.id === agentMsg.id ? { ...m, content: text } : m))
      }

      const maxIter = userText.includes('شامل') ? 22 : 12
      let iter = 0
      let cutRetries = 0

      if (engine === 'server') {
        const svr = await runServerAgent({
          project_id: selectedProject.id,
          mode: serverModeFor(mode),
          message: userText,
          history: messages.slice(-10).map(m => ({ role: (m.role === 'agent' ? 'assistant' : m.role) as LlmMessage['role'], content: m.content })),
          maxSteps: maxIter,
          signal,
          onEvent: {
            onDelta: (t) => { fullText += t; updateBubble(fullText) },
            onToolStart: (id, name) => { upsertChip({ id, name }); addLog('info', `أداة خادم: ${name}`) },
            onToolDone: (id, _name, toolOk, output) => { settleChip(id, toolOk, summarizeToolResult(output)) },
            onApproval: () => { setAgentStatus('waiting_approval'); addMessage('system', 'الوكيل اقترح تعديلاً ينتظر موافقتك — راجع «Git/الفرق».'); void refreshChanges() },
            onFileChanged: (p) => readFilesSet.add(p),
            onCommandDispatched: (wf) => addLog('info', `مهمة أُطلقت عبر GitHub Actions: ${wf}`),
            onError: (msg, kind) => addLog('error', `وكيل الخادم: ${msg}${kind ? ` (${kind})` : ''}`),
          },
        })
        if (signal.aborted) {
          setAgentStatus('stopped'); setIterationLabel(''); addLog('warning', 'إيقاف الوكيل أثناء العمل')
          return
        }
        if (svr.ok) {
          const finalContent = (svr.text ?? '').trim() || '(لم يُنتج الوكيل نصًا)'
          updateBubble(finalContent)
          setMessages(prev => prev.map(m => m.id === agentMsg.id ? { ...m, content: finalContent, provider: svr.provider ?? 'DeepSeek', model: 'server', files: [...readFilesSet] } : m))
          await supabase.from('projects').update({ agent_status: 'connected', last_agent_run_at: new Date().toISOString() }).eq('id', selectedProject.id).select('*').maybeSingle()
          await persistMessage(agentSession.id, 'agent', finalContent, {
            attachments: [...readFilesSet],
            actions: ['file_read'],
            provider: svr.provider ?? 'DeepSeek',
            model: 'server',
          })
          setAgentStatus(svr.waitingApproval ? 'waiting_approval' : 'completed')
          const dur = Math.round(((svr.durationMs ?? 0) / 1000))
          addLog('info', `خادم: ${svr.provider ?? 'DeepSeek'} · ${svr.usage?.total_tokens ?? '؟'} توكن · $${(svr.costEst?.$ ?? 0).toFixed(4)} · ${dur}s${svr.waitingApproval ? ' · بانتظار الموافقة' : ''}`)
        } else {
          addMessage('system', `فشل تنفيذ المهمة عبر الخادم: ${svr.error ?? 'خطأ غير معروف'}`)
          setAgentStatus('failed')
          addLog('error', `server agent turn: ${svr.error}`)
        }
        setIterationLabel(''); setStreaming(false)
        return
      }

      for (; iter < maxIter; iter++) {
        if (signal.aborted) break
        setAgentStatus('working')
        setIterationLabel(`جولة ${iter + 1}/${maxIter}`)

        const turn = { partial: '', toolCalls: [] as AiToolCall[], interrupted: false }
        const res = await aiGateway.streamChat({
          messages: llm,
          tools: AGENT_TOOLS,
          preferModelId: selectedModelId || undefined,
          signal,
          onChunk: (chunk) => {
            if (chunk.text) {
              turn.partial += chunk.text
              fullText += chunk.text
              updateBubble(fullText)
            }
            if (chunk.pendingTool) upsertChip({ id: chunk.pendingTool.id, name: chunk.pendingTool.name })
            if (chunk.toolCalls && chunk.toolCalls.length > 0) turn.toolCalls.push(...chunk.toolCalls)
            if (chunk.interrupted) { turn.interrupted = true; anyCut = true }
            if (chunk.error) {
              addLog('error', `خطأ AI: ${chunk.error}`)
            }
          },
          onStatus: (status) => {
            if (status.switchedFrom && status.switchedTo) {
              addLog('warning', `تبديل مزوّد أثناء البث: ${status.switchedFrom} → ${status.switchedTo}`)
            }
          },
        })

        if (!res.ok) throw new Error(res.error || 'فشل استدعاء النموذج')
        usedProvider = res.usedProvider || usedProvider
        usedModel = res.usedModel || usedModel
        if (signal.aborted) break

        // Auto-retry once when the upstream cut mid-stream with partial output.
        if (turn.interrupted && cutRetries < 1) {
          cutRetries += 1
          addLog('warning', 'انقطع البث — إعادة المحاولة تلقائيًا لاستكمال الرد.')
          llm.push({ role: 'user', content: 'انقطع ردك السابق. استكمل النص من حيث توقفت دون تكرار ما سبق.' })
          continue
        }

        const tcs = turn.toolCalls
        if (tcs.length === 0) {
          if (turn.interrupted) {
            fullText += '\n\n_…[انقطع البث في المحاولة الثانية ولم يُستكمل — أعد المحاولة من زر الإرسال]_'
            updateBubble(fullText)
          }
          break
        }

        // Register the assistant tool-call message, then execute every call.
        llm.push({
          role: 'assistant' as const,
          content: turn.partial,
          tool_calls: tcs.map(t => ({ id: t.id, type: 'function' as const, function: { name: t.function.name, arguments: t.function.arguments }, ...(t.extra_content ? { extra_content: t.extra_content } : {}) })),
        })

        for (const tc of tcs) {
          if (signal.aborted) break
          if (!turnTools.some(x => x.id === tc.id)) upsertChip({ id: tc.id, name: tc.function.name })
          const r = await execAgentTool(tc.function.name, tc.function.arguments, {
            repoRef: repoRef!,
            gitToken: gitToken.trim() || undefined,
            treePaths,
            onRead: (p: string) => readFilesSet.add(p),
          })
          const summary = summarizeToolResult(r.output)
          settleChip(tc.id, r.ok, summary)
          llm.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: r.output })
          addLog(r.ok ? 'info' : 'warning', `أداة ${tc.function.name} → ${r.ok ? `نجاح (${r.output.length} حرفًا)` : `فشل: ${r.output.slice(0, 120)}`}`)
          if (signal.aborted) break
        }

        llm = trimToolHistory(llm)
        addLog('info', `جولة ${iter + 1}/${maxIter} اكتملت (${tcs.length} أداة) — استمرار`)
        if (!repoRef) break
      }

      if (signal.aborted) {
        setAgentStatus('stopped')
        updateBubble(fullText || '…')
        setIterationLabel('')
        addLog('warning', 'إيقاف الوكيل أثناء العمل')
        return
      }

      const readFiles = [...readFilesSet]
      const finalContent = fullText || '(لم يُنتج الوكيل نصًا — انقطع البث أو المصدر فارغ)'

      setMessages(prev => prev.map(m => m.id === agentMsg.id
        ? { ...m, content: finalContent, provider: usedProvider, model: usedModel, files: readFiles }
        : m))

      addLog('info', `AI شارك عبر ${usedProvider}/${usedModel} (${iter} جولة، ${readFiles.length} ملفًا مقروءًا)`)
      await supabase.from('projects').update({
        agent_status: 'connected',
        last_agent_run_at: new Date().toISOString(),
      }).eq('id', selectedProject.id).select('*').maybeSingle()
      await persistMessage(agentSession.id, 'agent', anyCut ? `${finalContent}\n\n_منبه: انقطع البث أثناء هذا الرد._` : finalContent, {
        attachments: readFiles,
        actions: ['file_search', 'file_read'],
        provider: usedProvider,
        model: usedModel,
        modelId: models.find(m => m.model_id === usedModel)?.id,
      })
      setAgentStatus('completed')
      setIterationLabel('')
      addLog('info', `الجلسة اكتملت: ${anyCut ? 'بث مقطوع (استُكمل) ' : ''}${readFiles.length} ملفًا في المرفقات`)
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      if (!aborted) {
        const msg = err instanceof Error ? err.message : String(err)
        addMessage('system', `فشل تنفيذ المهمة: ${msg}`)
        setAgentStatus('failed')
        setIterationLabel('')
        addLog('error', `agentic turn: ${msg}`)
      } else {
        setAgentStatus('stopped')
      }
    } finally {
      setStreaming(false)
      setIterationLabel('')
    }
  }

  const stopAgent = () => {
    abortRef.current?.abort()
    setAgentStatus('stopped')
    if (agentSession) {
      void supabase.from('agent_sessions').update({ status: 'stopped', ended_at: new Date().toISOString() }).eq('id', agentSession.id)
    }
    addMessage('system', 'تم إيقاف الوكيل.')
    addLog('warning', 'Agent stopped by user')
    showToast('تم إيقاف الوكيل', 'warning')
  }

  const closeRoom = () => {
    abortRef.current?.abort()
    setSelectedProject(null)
    setAgentSession(null)
  }

  const runDiagnostic = () => void sendMessage('افحص المشروع بشكل شامل وقائمة المشاكل المحتملة مع أولوياتها.')

  const runWorkflow = async () => {
    if (!repoRef) return
    const wf = workflowPaths[0]
    if (!wf) { showToast('لا سير عمل تنفيذ — أضف awriq-run.yml أولاً (القالب أسفله)', 'warning'); return }
    if (!gitToken.trim()) { showToast('أدخل توكن GitHub في تبويب Git بصلاحية workflow', 'warning'); return }
    setRunBusy(true)
    try {
      const res = await dispatchAwriqWorkflow(repoRef, gitToken.trim(), wf, { command: runCmd.trim() })
      setTerminalOutput(prev => [...prev, {
        command: runCmd.trim() || '(بدون أمر — يستخدم الافتراضي في السير)',
        output: res.message,
        exitCode: res.accepted ? 0 : 1,
      }])
      showToast(res.accepted ? 'أُطلقت المهمة — تابع السجلات في GitHub Actions' : 'تعذر الإطلاق: ' + res.message, res.accepted ? 'success' : 'error')
      if (res.accepted) {
        await new Promise(r => setTimeout(r, 4000))
        const run = await latestWorkflowRun(repoRef, gitToken.trim(), wf)
        setTerminalOutput(prev => [...prev, {
          command: '',
          output: run
            ? `الجري #${run.id} — الحالة: ${run.status}\n${run.html_url}`
            : 'سير العمل أُطلق لكن لم يظهر الجري بعد — تحقق من تبويب Actions خلال لحظات.',
          exitCode: run ? 0 : 1,
        }])
      }
    } catch (err) {
      setTerminalOutput(prev => [...prev, { command: runCmd.trim() || '(run)', output: 'فشل الإطلاق: ' + (err instanceof Error ? err.message : String(err)), exitCode: 1 }])
    } finally {
      setRunBusy(false)
    }
  }

  const runSecretsScan = async () => {
    if (!repoRef) { showToast('اربط مستودع GitHub أولاً', 'warning'); return }
    setRunBusy(true)
    try {
      const r = await execAgentTool('scan_secrets', '{}', { repoRef, gitToken: gitToken.trim() || undefined, treePaths })
      const found = !r.output.includes('لا أسرار مكتشفة')
      setTerminalOutput(prev => [...prev, { command: 'scan_secrets', output: r.output, exitCode: found ? 1 : 0 }])
      showToast(r.ok ? (found ? 'عُثر على مؤشرات أسرار' : 'لا أسرار مكتشفة') : 'فشل الفحص', r.ok ? (found ? 'warning' : 'success') : 'error')
    } catch (err) {
      setTerminalOutput(prev => [...prev, { command: 'scan_secrets', output: String(err), exitCode: 1 }])
      showToast('فشل فحص الأسرار', 'error')
    } finally {
      setRunBusy(false)
    }
  }

  const tabs: { key: TabKey; label: string; icon: typeof Bot }[] = [
    { key: 'chat', label: 'المحادثة', icon: Bot },
    { key: 'files', label: 'الملفات', icon: FileCode },
    { key: 'terminal', label: 'الطرفية', icon: Terminal },
    { key: 'diff', label: 'الفرق', icon: GitBranch },
    { key: 'access', label: 'الوصول والرموز', icon: KeyRound },
    { key: 'settings', label: 'الإعدادات', icon: Settings },
    { key: 'logs', label: 'السجلات', icon: Activity },
    { key: 'tasks', label: 'المهام', icon: CheckCircle },
    { key: 'git', label: 'Git', icon: GitMerge },
  ]

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><Loader2 size={24} className="animate-pulse-soft" color="var(--awriq-secondary)" /></div>
  }

  if (!selectedProject) {
    return (
      <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>غرفة الوكيل البرمجي</h1>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>اختر المشروع لبدء جلسة الوكيل</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }} className="inst-grid">
          {projects.length === 0 ? (
            <div className="awriq-card" style={{ padding: '48px', textAlign: 'center', gridColumn: '1 / -1' }}>
              <Bot size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
              <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', marginBottom: '16px' }}>لا توجد مشاريع متاحة</p>
              <button onClick={() => navigate('/projects')} className="awriq-btn-primary">إنشاء مشروع</button>
            </div>
          ) : (
            projects.map((project) => (
              <div key={project.id} className="awriq-card" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <FolderGit2 size={24} color="#C89B5A" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '4px' }}>{project.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>
                      {project.repository_url ? <span style={{ direction: 'ltr', display: 'block', fontFamily: 'monospace' }}>{project.repository_url}</span> : (project.institutions?.name_ar || project.institutions?.name || '—')}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--awriq-secondary)' }}>البيئة</span>
                    <span style={{ fontWeight: 600, color: 'var(--awriq-text)' }}>{project.environment === 'production' ? 'إنتاج' : project.environment === 'staging' ? 'تجريبي' : 'تطوير'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--awriq-secondary)' }}>حالة الوكيل</span>
                    <span style={{ fontWeight: 600, color: project.agent_status === 'connected' ? '#4F8A5B' : '#68727A' }}>{project.agent_status === 'connected' ? 'متصل' : 'غير متصل'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--awriq-secondary)' }}>آخر تشغيل</span>
                    <span style={{ fontWeight: 500, color: 'var(--awriq-text)' }}>{formatRelativeTime(project.last_agent_run_at)}</span>
                  </div>
                </div>

                <button onClick={() => openProject(project)} className="awriq-btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Bot size={18} /> فتح المشروع
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  const tree = nestedTree(treePaths)
  const hasWorkflow = treePaths.some(p => p.startsWith('.github/workflows/'))
  const workflowPaths = treePaths.filter(p => p.startsWith('.github/workflows/') && p.endsWith('.yml')).sort()
  const selectedModel = models.find(m => m.id === selectedModelId) || null
  void selectedModel

  const renderTreeNode = (nodes: TreeNode[], depth: number) => (
    nodes.map((node, i) => (
      <div key={node.path + i}>
        <div
          onClick={() => node.type === 'file' && openFile(node.path)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: `4px 8px ${''}`, paddingRight: `${8 + depth * 14}px`, borderRadius: '4px', cursor: node.type === 'file' ? 'pointer' : 'default', fontSize: '12px', color: selectedFilePath === node.path ? '#C89B5A' : 'var(--awriq-text)', background: selectedFilePath === node.path ? 'rgba(200,155,90,0.08)' : 'transparent', transition: 'background 0.15s' }}
        >
          {node.type === 'folder' ? <Folder size={14} color="#C89B5A" /> : <FileText size={13} color="var(--awriq-secondary)" />}
          <span style={{ direction: 'ltr', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        </div>
        {node.type === 'folder' && node.children && renderTreeNode(node.children, depth + 1)}
      </div>
    ))
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--awriq-border)', background: 'var(--awriq-surface)', flexShrink: 0, flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={closeRoom} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--awriq-secondary)', display: 'flex', alignItems: 'center' }}>
            <ArrowRight size={20} />
          </button>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FolderGit2 size={18} color="#C89B5A" />
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--awriq-text)' }}>{selectedProject.name}</div>
            <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{selectedProject.institutions?.name_ar || selectedProject.institutions?.name || repoRef ? `${repoRef?.owner}/${repoRef?.repo}` : ''}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as AgentMode)}
            className="awriq-input"
            style={{ width: 'auto', padding: '6px 28px 6px 12px', fontSize: '12px', cursor: 'pointer', appearance: 'none', backgroundImage: 'none' }}
          >
            {(Object.keys(modeLabels) as AgentMode[]).map(m => (
              <option key={m} value={m}>{modeLabels[m]}{m === 'read_only' ? ' (نشط)' : ''}</option>
            ))}
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColors[agentStatus], animation: streaming ? 'pulse-soft 2s infinite' : 'none' }} />
            <span style={{ color: statusColors[agentStatus] }}>{streaming ? 'البث...' : statusLabels[agentStatus]}</span>
            {iterationLabel && (
              <span style={{ color: '#8A5A2B', background: 'rgba(200,155,90,0.12)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>{iterationLabel}</span>
            )}
            {turnTools.length > 0 && (
              <span style={{ color: 'var(--awriq-secondary)', fontSize: '11px' }}>أدوات: {turnTools.filter(t => t.status === 'ok').length}✓ / {turnTools.filter(t => t.status === 'error').length}✗</span>
            )}
          </div>

          {streaming && (
            <button onClick={stopAgent} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #C94B4B', background: 'rgba(201,75,75,0.08)', color: '#C94B4B', cursor: 'pointer', fontSize: '12px', fontWeight: 600, fontFamily: 'Cairo, sans-serif' }}>
              <StopCircle size={16} /> إيقاف
            </button>
          )}
        </div>
      </div>

      {/* Model strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderBottom: '1px solid var(--awriq-border)', background: 'rgba(200,155,90,0.03)', flexShrink: 0, flexWrap: 'wrap', fontSize: '11px' }}>
        <Cpu size={13} color="#8A5A2B" />
        {engine === 'server' ? (
          <span style={{ color: '#4F8A5B', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
            <Server size={13} /> وكيل الخادم (DeepSeek) — لا حاجة لأي نموذج من الواجهة
          </span>
        ) : (
          <>
            <span style={{ color: 'var(--awriq-secondary)', fontWeight: 600 }}>نموذج الرد:</span>
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="awriq-input"
              style={{ width: 'auto', padding: '2px 22px 2px 8px', fontSize: '11px', cursor: 'pointer', appearance: 'none', backgroundImage: 'none' }}
            >
              <option value="">(افتراضي مجاني)</option>
              {models.filter(m => m.is_enabled).map((m) => {
                const p = providers.find(p => p.id === m.provider_id)
                return (
                  <option key={m.id} value={m.id}>{m.name}{m.is_default ? ' ★' : ''} — {p?.name}{p?.is_free ? ' (مجاني)' : ''}</option>
                )
              })}
            </select>
            <button
              onClick={async () => {
                await aiGateway.loadFromDb()
                setProviders(aiGateway.getProviders())
                setModels(aiGateway.getModels())
                showToast('تم تحديث قائمة المزوّدات والنماذج', 'success')
              }}
              title="تحديث قائمة المزوّدات من قاعدة البيانات"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '6px', border: '1px solid var(--awriq-border)', background: 'transparent', color: 'var(--awriq-secondary)', cursor: 'pointer' }}
            >
              <RefreshCw size={12} />
            </button>
            {models.length === 0 && <span style={{ color: '#C58A3A' }}>لا مزودات محمّلة</span>}
          </>
        )}
        <span style={{ flex: 1 }} />
        {writeModes.includes(mode) && <span style={{ color: '#C58A3A', display: 'flex', alignItems: 'center', gap: '4px' }}><GitCommitHorizontal size={12} /> أدوات الكتابة فعّالة — الاقتراحات تُوافق قبل التطبيق</span>}
        {repoRef && (
          <span style={{ color: 'var(--awriq-secondary)', display: 'flex', alignItems: 'center', gap: '4px', direction: 'ltr', fontFamily: 'monospace' }}>
            <GitBranch size={12} /> {repoRef.owner}/{repoRef.repo}@{repoRef.branch}
          </span>
        )}
      </div>

      {/* Main workspace */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left sidebar: project info + files */}
        <div style={{ width: '240px', borderLeft: '1px solid var(--awriq-border)', background: 'var(--awriq-surface)', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }} className="agent-sidebar-left">
          <div style={{ padding: '12px', borderBottom: '1px solid var(--awriq-border)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--awriq-secondary)', marginBottom: '8px', textTransform: 'uppercase' }}>الملفات ({treePaths.length})</div>
            {!repoRef ? (
              <div style={{ fontSize: '11px', color: '#C58A3A', lineHeight: 1.6 }}>
                لم يُربط مستودع GitHub. اضبط <code style={{ direction: 'ltr', display: 'inline-block' }}>repository_url</code> في صفحة المشاريع.
              </div>
            ) : treeLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>
                <Loader2 size={14} className="animate-pulse-soft" /> جاري تحميل الشجرة...
              </div>
            ) : treePaths.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>لا ملفات (أو المستودع فارغ/خاص).</div>
            ) : (
              renderTreeNode(tree, 0)
            )}
          </div>
          <div style={{ padding: '12px', borderTop: '1px solid var(--awriq-border)', fontSize: '11px', lineHeight: 1.9 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase' }}>الاتصالات</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <GitBranch size={12} color={githubOk === true ? '#4F8A5B' : githubOk === false ? '#C94B4B' : 'var(--awriq-secondary)'} />
              Git: {repoRef ? (
                <span style={{ color: githubOk === true ? '#4F8A5B' : githubOk === false ? '#C94B4B' : 'var(--awriq-secondary)', fontWeight: githubOk === true || githubOk === false ? 700 : 400 }}>
                  {githubOk === true ? `متصل (${treePaths.length} ملف)` : githubOk === false ? 'غير متصل/خاص' : 'جارٍ التحقق...'}
                </span>
              ) : 'غير مرتبط'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Server size={12} color={selectedProject.vercel_project ? '#C58A3A' : 'var(--awriq-secondary)'} />
              Vercel: {selectedProject.vercel_project ? `مُعرَّف (${selectedProject.vercel_project})` : 'غير مُعرَّف'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Database size={12} color={selectedProject.supabase_project ? '#C58A3A' : 'var(--awriq-secondary)'} />
              Supabase: {selectedProject.supabase_project ? `ref ${selectedProject.supabase_project}` : 'غير مُعرَّف'}
            </div>
            {integrations.length > 0 && integrations.map((i) => (
              <div key={i.kind} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Database size={12} color={i.is_connected ? '#4F8A5B' : '#C94B4B'} />
                {i.kind}: {i.is_connected ? 'متصل' : 'غير متصل'}{i.provider_ref ? ` (${i.provider_ref})` : ''}
              </div>
            ))}
            <div style={{ fontSize: '10px', color: 'var(--awriq-secondary)', marginTop: '4px' }}>
              حالة Vercel/Supabase قراءة تقديرية فقط — تؤكد من تبويب «الوصول والرموز» بالاعتمادات الفعلية.
            </div>
          </div>
          <div style={{ padding: '12px', borderTop: '1px solid var(--awriq-border)', fontSize: '11px', color: 'var(--awriq-secondary)', lineHeight: 1.7 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase' }}>معلومات المشروع</div>
            <div>البيئة: {selectedProject.environment}</div>
            <div>الحالة: {selectedProject.agent_status}</div>
            <div>آخر تشغيل: {formatRelativeTime(selectedProject.last_agent_run_at)}</div>
          </div>
        </div>

        {/* Center: tab content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '2px', padding: '0 8px', borderBottom: '1px solid var(--awriq-border)', background: 'var(--awriq-surface)', overflowX: 'auto', flexShrink: 0 }}>
            {tabs.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px',
                    fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                    fontFamily: 'Cairo, sans-serif', background: 'transparent',
                    color: activeTab === tab.key ? '#C89B5A' : 'var(--awriq-secondary)',
                    borderBottom: activeTab === tab.key ? '2px solid #C89B5A' : '2px solid transparent',
                    transition: 'all 0.15s', whiteSpace: 'nowrap',
                  }}
                >
                  <Icon size={14} /> {tab.label}
                </button>
              )
            })}
          </div>

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeTab === 'chat' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div ref={chatListRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {messages.map((msg) => (
                    <div key={msg.id} style={{ display: 'flex', gap: '10px', alignSelf: msg.role === 'user' ? 'flex-start' : 'flex-end', maxWidth: '86%', width: msg.role === 'user' ? undefined : '100%' }}>
                      {msg.role === 'user' && (
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, #C89B5A, #8A5A2B)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ color: 'white', fontSize: '13px', fontWeight: 700 }}>U</span>
                        </div>
                      )}
                      <div style={{ flex: 1, background: msg.role === 'user' ? 'var(--awriq-surface)' : msg.role === 'system' ? 'rgba(104,114,122,0.08)' : 'rgba(200,155,90,0.08)', border: '1px solid', borderColor: msg.role === 'system' ? 'rgba(104,114,122,0.2)' : 'var(--awriq-border)', borderRadius: '12px', padding: '12px 16px', maxWidth: '100%' }}>
                        <pre style={{ margin: 0, fontSize: '13px', lineHeight: 1.6, color: 'var(--awriq-text)', fontFamily: 'Cairo, sans-serif', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</pre>
                        {msg.actions && msg.actions.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                            {msg.actions.map((a, i) => (
                              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#8A5A2B', background: 'rgba(200,155,90,0.1)', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                                <Cpu size={10} /> {a}
                              </span>
                            ))}
                          </div>
                        )}
                        {msg.role === 'agent' && turnTools.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px', borderTop: '1px dashed var(--awriq-border)', paddingTop: '8px' }}>
                            {turnTools.map((t) => (
                              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontFamily: 'monospace' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '150px', color: '#8A5A2B' }}>
                                  {t.name.startsWith('read') ? <FileCode size={11} /> : t.name === 'grep' ? <Search size={11} /> : <Wrench size={11} />} {t.name}
                                </span>
                                {t.status === 'running' && <Loader2 size={12} className="animate-pulse-soft" color="#C89B5A" />}
                                {t.status === 'ok' && <Check size={12} color="#4F8A5B" />}
                                {t.status === 'error' && <XCircle size={12} color="#C94B4B" />}
                                {t.summary && <span style={{ color: 'var(--awriq-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '360px' }}>{t.summary}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.model && <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--awriq-secondary)', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '4px' }}><Cpu size={10} /> {msg.provider}/{msg.model}</div>}
                        {msg.files && msg.files.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px', alignItems: 'center' }}>
                            <span style={{ fontSize: '10px', color: '#8A5A2B', fontWeight: 700 }}>الملفات المقروءة ({msg.files.length}):</span>
                            {msg.files.slice(0, 16).map((f, i) => (
                              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>
                                <FileCode size={10} /> {f}
                              </span>
                            ))}
                            {msg.files.length > 16 && <span style={{ fontSize: '10px', color: 'var(--awriq-secondary)' }}>+{msg.files.length - 16}</span>}
                          </div>
                        )}
                      </div>
                      {msg.role === 'agent' && (
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Bot size={16} color="#C89B5A" />
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                <div style={{ padding: '8px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid var(--awriq-border)' }}>
                  <button onClick={runDiagnostic} disabled={streaming} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}>
                    <Bug size={14} /> فحص شامل
                  </button>
                  <button
                    onClick={() => { if (repoRef) { setActiveTab('files'); void loadTree(repoRef, selectedProject.id) } else { showToast('لم يُربط مستودع GitHub', 'warning') } }}
                    disabled={streaming}
                    className="awriq-btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}
                  >
                    <RefreshCw size={14} /> تحديث الشجرة
                  </button>
                  {repoRef && (
                    <a href={`https://github.com/${repoRef.owner}/${repoRef.repo}`} target="_blank" rel="noopener noreferrer" className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}>
                      <ExternalLink size={14} /> GitHub
                    </a>
                  )}
                </div>

                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--awriq-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <textarea
                    ref={composerRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !streaming) {
                        e.preventDefault()
                        void sendMessage()
                      }
                    }}
                    rows={2}
                    placeholder={writeModes.includes(mode) ? 'اطلب من الوكيل إصلاحاً (الكتابة في M3)...\nاكتب الفحص أو اشرح ما تريد — Enter للإرسال، Shift+Enter لسطر جديد' : 'اكتب: افحص هذا الملف / اشرح البنية / افحص المشروع...\nEnter للإرسال، Shift+Enter لسطر جديد'}
                    className="awriq-input"
                    style={{
                      flex: 1, fontSize: '13px', resize: 'none', lineHeight: 1.6,
                      minHeight: '44px', maxHeight: '220px', fontFamily: 'Cairo, sans-serif',
                    }}
                    disabled={streaming}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '10px', color: 'var(--awriq-secondary)' }}>
                      {writeModes.includes(mode) ? 'أدوات الكتابة فعّالة — الاقتراحات تُعرض في «الفرق» وتُطبّق بعد موافقتك' : 'وضع القراءة فقط — الوكيل يفحص ويشرح دون تغيير'}
                    </span>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button onClick={() => { setActiveTab('diff'); void refreshChanges() }} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}>
                        <GitBranch size={14} /> الفرق ({fileChanges.filter(f => !f.is_applied).length})
                      </button>
                      <button onClick={() => void sendMessage()} disabled={!input.trim() || streaming} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 20px' }}>
                        {streaming ? <Loader2 size={16} className="animate-pulse-soft" /> : <Send size={16} />} إرسال
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'files' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                {!repoRef ? (
                  <div style={{ textAlign: 'center', padding: '48px', color: 'var(--awriq-secondary)', fontSize: '14px' }}>
                    <FileCode size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
                    لم يُربط مستودع GitHub لهذا المشروع.
                  </div>
                ) : selectedFilePath ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                      <FileCode size={18} color="#C89B5A" />
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--awriq-text)', fontFamily: 'monospace', direction: 'ltr', textAlign: 'left' }}>{selectedFilePath}</span>
                      {writeModes.includes(mode) && !fileProtected && (
                        <div style={{ display: 'flex', gap: '6px', marginRight: 'auto' }}>
                          <button
                            onClick={() => setDraftContent(fileContent ?? '')}
                            disabled={commitBusy}
                            className="awriq-btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', padding: '4px 10px' }}
                          >
                            <Save size={12} /> تعديل/اقتراح
                          </button>
                          <button
                            onClick={() => proposeFileEdit(selectedFilePath, '', 'delete')}
                            disabled={commitBusy}
                            className="awriq-btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', padding: '4px 10px', color: '#C94B4B', borderColor: 'rgba(201,75,75,0.4)' }}
                          >
                            <XCircle size={12} /> حذف
                          </button>
                        </div>
                      )}
                    </div>
                    {fileProtected ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#C94B4B', padding: '20px', background: 'var(--awriq-surface)', border: '1px solid var(--awriq-border)', borderRadius: '8px' }}>
                        <Lock size={20} />
                        <span>هذا الملف محمي — لا يُعرض في المتصفح حفاظاً على الأسرار.</span>
                      </div>
                    ) : draftContent !== null ? (
                      <div>
                        <textarea
                          value={draftContent}
                          onChange={(e) => setDraftContent(e.target.value)}
                          spellCheck={false}
                          style={{ width: '100%', minHeight: '320px', background: 'rgba(13,18,24,0.6)', border: '1px solid var(--awriq-border)', borderRadius: '8px', padding: '14px', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.6, color: 'var(--awriq-text)', whiteSpace: 'pre', direction: 'ltr', textAlign: 'left', resize: 'vertical', outline: 'none' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                          <button
                            onClick={() => proposeFileEdit(selectedFilePath, draftContent, 'modify')}
                            disabled={commitBusy || draftContent === null}
                            className="awriq-btn-primary"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 16px' }}
                          >
                            <GitCommitHorizontal size={14} /> {commitBusy ? 'جاري التطبيق...' : 'اقتراح كتغيير (يتطلب موافقة)'}
                          </button>
                          <button
                            onClick={() => setDraftContent(null)}
                            disabled={commitBusy}
                            className="awriq-btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 16px' }}
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    ) : fileLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--awriq-secondary)', padding: '20px' }}>
                        <Loader2 size={16} className="animate-pulse-soft" /> جاري قراءة الملف...
                      </div>
                    ) : (
                      <pre style={{ background: 'var(--awriq-surface)', border: '1px solid var(--awriq-border)', borderRadius: '8px', padding: '16px', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.6, color: 'var(--awriq-text)', whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left' }}>{fileContent ?? '(فارغ)'}</pre>
                    )}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '48px', color: 'var(--awriq-secondary)', fontSize: '14px' }}>
                    <FileCode size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
                    اختر ملفًا من قائمة الملفات الجانبية
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#8A5A2B' }}>{writeModes.includes(mode) ? 'وضع الكتابة نشط: افتح ملفًا لتعديله أو اقتراح حذفه — أي تطبيق يتطلب موافقة.' : 'الوضع الحالي للقراءة فقط — تبديل الوضع إلى "إصلاح بموافقة" للسماح بالتعديلات.'}</div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'terminal' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px', fontFamily: 'Cairo, sans-serif' }}>
                <div className="awriq-card" style={{ padding: '20px', marginBottom: '16px', border: '1px solid rgba(200,155,90,0.3)', background: 'rgba(200,155,90,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Terminal size={18} color="#C89B5A" />
                    <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)' }}>المنفّذ الحقيقي للأوامر والاختبارات</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--awriq-secondary)', lineHeight: 1.8, margin: 0 }}>
                    لا أدّعي تنفيذ أمرٍ لم يُشغَّل فعلاً. التنفيذ الحقيقي (build / tests / scripts) يعمل عبر سير عمل GitHub Actions
                    <code style={{ direction: 'ltr', display: 'inline-block', margin: '0 4px' }}>awriq-run.yml</code> يُشغَّل من هنا بعقد <code>workflow_dispatch</code>، وتظهر النتائج الفعلية (Exit code + سجلات) هنا.
                  </p>
                </div>

                {repoRef ? (
                  <>
                    <div className="awriq-card" style={{ padding: '16px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <GitPullRequest size={15} color="#C89B5A" /> حالة المنفّذ في المستودع
                      </div>
                      {treeLoading ? (
                        <span style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>جاري فحص الشجرة...</span>
                      ) : hasWorkflow ? (
                        <div style={{ fontSize: '12px', color: '#4F8A5B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Check size={14} /> وُجد سير عمل تنفيذ في <code style={{ direction: 'ltr' }}>{workflowPaths.join('، ')}</code> — يمكن الربط لإطلاقه من هنا.
                        </div>
                      ) : (
                        <div style={{ fontSize: '12px', color: '#C58A3A', lineHeight: 1.7 }}>
                          لا يوجد سير عمل تنفيذ بعد. أضف <code style={{ direction: 'ltr' }}>awriq-run.yml</code> إلى <code style={{ direction: 'ltr' }}>.github/workflows/</code> في المستودع (القالب الجاهز أدناه)، ثم آتِ للربط والتشغيل.
                        </div>
                      )}
                    </div>

                    <div className="awriq-card" style={{ padding: '16px', marginBottom: '16px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)', display: 'block', marginBottom: '6px' }}>
                        الأمر المراد تنفيذه في المستودع (build / tests / أوامر)
                      </label>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'stretch' }}>
                        <input
                          value={runCmd}
                          onChange={(e) => setRunCmd(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void runWorkflow() }}
                          placeholder="مثال: npm run build || php artisan test"
                          className="awriq-input"
                          style={{ flex: 1, minWidth: '220px', fontSize: '12px', fontFamily: 'monospace', direction: 'ltr', textAlign: 'left' }}
                        />
                        <button onClick={runWorkflow} disabled={runBusy || !hasWorkflow || !gitToken.trim()} className="awriq-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 16px' }}>
                          <Play size={14} /> {runBusy ? 'جاري...' : 'تشغيل في المستودع'}
                        </button>
                        <button onClick={runSecretsScan} disabled={runBusy} className="awriq-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 14px' }}>
                          <Shield size={14} /> مسح الأسرار
                        </button>
                      </div>
                      {!hasWorkflow && <div style={{ fontSize: '11px', color: '#C58A3A', marginTop: '8px' }}>أضف سير العمل أولاً ليُرحَّل زِرّ التشغيل — أو استخدم «مسح الأسرار» الآن.</div>}
                      {hasWorkflow && !gitToken.trim() && <div style={{ fontSize: '11px', color: '#C58A3A', marginTop: '8px' }}>أدخل توكن GitHub في تبويب Git للسماح بالإطلاق.</div>}
                    </div>

                    <div className="awriq-card" style={{ padding: '16px', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--awriq-text)' }}>قالب <code style={{ direction: 'ltr' }}>.github/workflows/awriq-run.yml</code></span>
                        <button onClick={() => { navigator.clipboard.writeText(WORKFLOW_TEMPLATE); showToast('نُسخ قالب السير العمل', 'success') }} className="awriq-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}>
                          <Copy size={13} /> نسخ
                        </button>
                      </div>
                      <pre style={{ background: '#0D1218', color: '#E6DED3', borderRadius: '8px', padding: '14px', fontSize: '12px', lineHeight: 1.6, overflowX: 'auto', whiteSpace: 'pre', direction: 'ltr', textAlign: 'left', margin: 0 }}>{WORKFLOW_TEMPLATE}</pre>
                    </div>
                  </>
                ) : (
                  <div className="awriq-card" style={{ padding: '16px', fontSize: '13px', color: 'var(--awriq-secondary)' }}>اربط مستودع GitHub لهذا المشروع أولاً.</div>
                )}

                {terminalOutput.length > 0 && (
                  <div style={{ background: '#0D1218', borderRadius: '8px', padding: '16px', fontFamily: 'monospace', fontSize: '12px' }}>
                    {terminalOutput.map((cmd, i) => (
                      <div key={i} style={{ marginBottom: '12px' }}>
                        <div style={{ color: '#C89B5A', marginBottom: '4px' }}>$ {cmd.command}</div>
                        <pre style={{ color: '#E6DED3', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{cmd.output}</pre>
                        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#68727A', marginTop: '4px' }}>
                          <span style={{ color: cmd.exitCode === 0 ? '#4F8A5B' : '#C94B4B' }}>Exit: {cmd.exitCode}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'diff' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                {fileChanges.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px', color: 'var(--awriq-secondary)', fontSize: '14px' }}>
                    <GitBranch size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
                    لا تغييرات مقترحة — افتح ملفًا واعدّله ثم اقترحه كتغيير.
                    <div style={{ marginTop: '8px', fontSize: '12px' }}>
                      <button onClick={refreshChanges} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px', margin: '0 auto' }}>
                        <RefreshCw size={14} /> تحديث
                      </button>
                    </div>
                  </div>
                ) : (
                  fileChanges.map((fc) => {
                    const lines = buildLineDiff(fc.old_content, fc.new_content)
                    const stats = diffStats(lines)
                    const pending = approvals.find(a => a.id === fc.approval_id)
                    return (
                      <div key={fc.id} className="awriq-card" style={{ padding: '16px', marginBottom: '12px', border: fc.is_applied ? '1px solid rgba(79,138,91,0.4)' : pending?.status === 'rejected' ? '1px solid rgba(201,75,75,0.4)' : '1px solid rgba(197,138,58,0.3)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <FileCode size={14} color="#C89B5A" />
                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', fontFamily: 'monospace', direction: 'ltr' }}>{fc.file_path}</span>
                            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: fc.change_type === 'delete' ? 'rgba(201,75,75,0.1)' : 'rgba(200,155,90,0.1)', color: fc.change_type === 'delete' ? '#C94B4B' : '#C89B5A', fontWeight: 700 }}>
                              {fc.change_type === 'create' ? 'إنشاء' : fc.change_type === 'delete' ? 'حذف' : 'تعديل'}
                            </span>
                            {fc.commit_sha && <a href={`https://github.com/${repoRef?.owner}/${repoRef?.repo}/commit/${fc.commit_sha}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', fontFamily: 'monospace', color: '#4F8A5B', display: 'flex', alignItems: 'center', gap: '3px' }}><GitCommitHorizontal size={11} /> {fc.commit_sha.slice(0, 7)}</a>}
                          </div>
                          <div style={{ display: 'flex', gap: '8px', fontSize: '12px' }}>
                            <span style={{ color: '#4F8A5B' }}>+{stats.added}</span>
                            <span style={{ color: '#C94B4B' }}>-{stats.removed}</span>
                            {fc.is_applied && <span style={{ color: '#4F8A5B', fontWeight: 700 }}>✓ مطبق</span>}
                            {!fc.is_applied && pending?.status === 'rejected' && <span style={{ color: '#C94B4B', fontWeight: 700 }}>مرفوض</span>}
                            {!fc.is_applied && (!pending || pending.status === 'pending') && <span style={{ color: '#C58A3A', fontWeight: 700 }}>بانتظار الموافقة</span>}
                          </div>
                        </div>
                        {pending && (
                          <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', marginBottom: '8px' }}>
                            طلب موافقة {pending.risk_level === 'high' ? 'عالية الخطورة' : 'متوسطة'} • {pending.description} • تنتهي خلال {formatCountdown(pending.expires_at)}
                          </div>
                        )}
                        <div style={{ background: 'rgba(13,18,24,0.5)', borderRadius: '6px', overflow: 'hidden', direction: 'ltr', textAlign: 'left' }}>
                          {lines.length === 0 ? (
                            <div style={{ padding: '10px', fontSize: '12px', color: '#68727A' }}>(لا فرق سطري)</div>
                          ) : (
                            lines.map((l, i) => (
                              <div key={i} style={{ display: 'flex', padding: '0 10px', fontSize: '12px', lineHeight: 1.6, fontFamily: 'monospace', background: l.type === 'add' ? 'rgba(79,138,91,0.12)' : l.type === 'rem' ? 'rgba(201,75,75,0.12)' : 'transparent', color: l.type === 'add' ? '#7FC9A0' : l.type === 'rem' ? '#E08E8E' : '#8A949E' }}>
                                <span style={{ width: '24px', flexShrink: 0, color: '#4A545E', userSelect: 'none' }}>{l.type === 'add' ? '+' : l.type === 'rem' ? '-' : ' '}</span>
                                <span style={{ whiteSpace: 'pre-wrap', flex: 1 }}>{l.text || ' '}</span>
                              </div>
                            ))
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                          {!fc.is_applied && pending?.status === 'pending' && (
                            <>
                              <button onClick={() => reviewApproval(pending, true)} disabled={commitBusy} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', padding: '6px 14px' }}>
                                <Check size={13} /> {commitBusy ? 'جاري...' : 'موافقة وتطبيق'}
                              </button>
                              <button onClick={() => reviewApproval(pending, false)} disabled={commitBusy} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', padding: '6px 14px', color: '#C94B4B', borderColor: 'rgba(201,75,75,0.4)' }}>
                                <XCircle size={13} /> رفض
                              </button>
                            </>
                          )}
                          {!fc.is_applied && pending?.status === 'rejected' && (
                            <button onClick={() => reviewApproval(pending, true)} disabled={commitBusy} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', padding: '6px 14px' }}>
                              <Check size={13} /> إعادة قبول
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {activeTab === 'access' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <AccessTokensPage projectId={selectedProject.id} />
                <ProjectAccessPage projectId={selectedProject.id} />
              </div>
            )}

            {activeTab === 'settings' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="awriq-card" style={{ padding: '16px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--awriq-text)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Cpu size={16} color="#C89B5A" /> محرك الوكيل
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {(["server", "client"] as const).map((e) => (
                      <label key={e} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                        <input type="radio" name="agent-engine" checked={engine === e} onChange={() => { setEngine(e); localStorage.setItem('awriq_room_engine', e) }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{e === 'server' ? 'وكيل الخادم (DeepSeek)' : 'وكيل مباشر (مزوّد الواجهة)'}</div>
                          <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>
                            {e === 'server' ? 'يركض داخل Supabase Edge — مفتاح DeepSeek لا يصل للمتصفح، والأدوات تنفذ حقيقيا من الخادم.' : 'يركض في المتصفح عبر مزوّد AI المحدد أسفل الصفحة ونماذجه (قد يُحتاج توكن GitHub مكتوب).'}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <AIProvidersPage />
                <SecurityPage />
                <SupportPage />
              </div>
            )}

            {activeTab === 'logs' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px', background: '#0D1218', fontFamily: 'monospace', fontSize: '12px' }}>
                {logs.length === 0 ? (
                  <div style={{ color: '#68727A', textAlign: 'center', padding: '48px' }}>لا سجلات</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ color: '#68727A', flexShrink: 0 }}>{new Date(log.timestamp).toLocaleTimeString('en-GB')}</span>
                      <span style={{ color: log.level === 'error' ? '#C94B4B' : log.level === 'warning' ? '#C58A3A' : '#4F8A5B', flexShrink: 0, textTransform: 'uppercase' }}>[{log.level}]</span>
                      <span style={{ color: '#E6DED3' }}>{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'tasks' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                {tasks.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px', color: 'var(--awriq-secondary)', fontSize: '14px' }}>
                    <CheckCircle size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
                    لا مهام محفوظة — تتبع المهام في M3.
                  </div>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className="awriq-card" style={{ padding: '14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: task.status === 'completed' ? 'rgba(79,138,91,0.1)' : 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {task.status === 'completed' ? <CheckCircle size={16} color="#4F8A5B" /> : <Loader size={16} color="#C89B5A" />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{task.title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(task.created_at)}</div>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{task.status}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'git' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                <div className="awriq-card" style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <GitMerge size={18} color="#C89B5A" /> Git — الالتزام والنشر
                  </h3>
                  {repoRef ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                        <span style={{ color: 'var(--awriq-secondary)' }}>المستودع</span>
                        <span style={{ fontWeight: 600, fontFamily: 'monospace', color: 'var(--awriq-text)', direction: 'ltr' }}>{repoRef.owner}/{repoRef.repo}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                        <span style={{ color: 'var(--awriq-secondary)' }}>الفرع</span>
                        <span style={{ fontWeight: 600, fontFamily: 'monospace', color: 'var(--awriq-text)' }}>{repoRef.branch === 'HEAD' ? 'افتراضي (main/master)' : repoRef.branch}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                        <span style={{ color: 'var(--awriq-secondary)' }}>التغييرات المقترحة</span>
                        <span style={{ fontWeight: 600, color: fileChanges.filter(f => !f.is_applied).length > 0 ? '#C58A3A' : '#68727A' }}>{fileChanges.filter(f => !f.is_applied).length}</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)' }}>لم يُربط مستودع.</div>
                  )}

                  <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>توكن GitHub (للتطبيق والنشر)</label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'stretch' }}>
                      <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
                        <KeyRound size={13} color="var(--awriq-secondary)" style={{ position: 'absolute', right: '10px', top: '10px' }} />
                        <input
                          type="password"
                          value={gitToken}
                          onChange={(e) => setGitToken(e.target.value)}
                          placeholder="ghp_... أو fine-grained PAT (محتويات: كتابة)"
                          className="awriq-input"
                          style={{ width: '100%', fontSize: '12px', paddingRight: '32px', fontFamily: 'monospace' }}
                          dir="ltr"
                        />
                      </div>
                      <button onClick={async () => { if (!gitToken.trim()) { showToast('أدخل التوكن أولاً', 'warning'); return } showToast('جاري التحقق من التوكن...', 'info'); try { await commitGithubFiles(repoRef!, gitToken.trim(), [{ path: '.awriq_ping', content: 'ping' }], 'awriq: verify token'); showToast('التوكن صالح — تم إنشاء التزام تحقق', 'success'); void refreshChanges() } catch (err) { showToast('فشل التحقق: ' + (err instanceof Error ? err.message : String(err)), 'error'); showToast('ملاحظة: قد يكون الأنفجار خلق التزامًا — تفحص الـGitHub.', 'warning') } }} disabled={commitBusy || !repoRef} className="awriq-btn-secondary" style={{ fontSize: '12px', padding: '8px 14px' }}>
                        <RefreshCw size={13} /> تحقق من التوكن
                      </button>
                    </div>
                  </div>

                  {fileChanges.filter(f => !f.is_applied).length > 0 && (
                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--awriq-text)' }}>التغييرات المعلقة ({fileChanges.filter(f => !f.is_applied).length})</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => reviewAllApprovals(true)} disabled={commitBusy} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', padding: '6px 14px' }}>
                            <Check size={13} /> الموافقة على الكل وتطبيق
                          </button>
                          <button onClick={() => reviewAllApprovals(false)} disabled={commitBusy} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', padding: '6px 14px', color: '#C94B4B', borderColor: 'rgba(201,75,75,0.4)' }}>
                            <XCircle size={13} /> رفض الكل
                          </button>
                        </div>
                      </div>
                      {fileChanges.filter(f => !f.is_applied).map((fc) => {
                        const ap = approvals.find(a => a.id === fc.approval_id)
                        return (
                          <div key={fc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--awriq-surface)', border: '1px solid var(--awriq-border)', borderRadius: '8px', flexWrap: 'wrap' }}>
                            <FileCode size={13} color="#C89B5A" />
                            <span style={{ fontSize: '12px', fontFamily: 'monospace', direction: 'ltr', color: 'var(--awriq-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fc.file_path}</span>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: fc.change_type === 'delete' ? '#C94B4B' : '#C89B5A' }}>{fc.change_type === 'create' ? 'جديد' : fc.change_type === 'delete' ? 'حذف' : 'تعديل'}</span>
                            <span style={{ fontSize: '11px', color: ap?.status === 'approved' ? '#4F8A5B' : ap?.status === 'rejected' ? '#C94B4B' : '#C58A3A' }}>
                              {ap?.status === 'approved' ? '✓ موافقة' : ap?.status === 'rejected' ? 'مرفوض' : ap?.status === 'expired' ? 'منتهية' : 'معلقة'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {fileChanges.some(f => f.is_applied) && (
                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--awriq-text)' }}>التغييرات المُطبَّقة (المنشورة)</span>
                      {fileChanges.filter(f => f.is_applied).map((fc) => (
                        <div key={fc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'rgba(79,138,91,0.06)', border: '1px solid rgba(79,138,91,0.3)', borderRadius: '8px', fontSize: '12px' }}>
                          <CheckCircle size={13} color="#4F8A5B" />
                          <span style={{ fontFamily: 'monospace', direction: 'ltr', color: 'var(--awriq-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fc.file_path}</span>
                          {fc.commit_sha && <a href={`https://github.com/${repoRef?.owner}/${repoRef?.repo}/commit/${fc.commit_sha}`} target="_blank" rel="noopener noreferrer" style={{ color: '#4F8A5B', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '4px' }}><GitCommitHorizontal size={12} /> {fc.commit_sha.slice(0, 7)} <ExternalLink size={11} /></a>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(200,155,90,0.06)', borderRadius: '8px', display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: '#8A5A2B' }}>
                    <Shield size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      أي تغيير يظهر هنا هو <b>اقتراح</b> في قاعدة البيانات — لا يمسّ مستودع GitHub حتى تمنح موافقتك (أو ترفضه تعتبر منتهي خلال 10 دقائق). الموافقة تنفّذ التزامًا واحدًا يشمل كل الملفات المرتبطة.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        {approvals.length > 0 && (
          <div style={{ width: '280px', borderRight: '1px solid var(--awriq-border)', background: 'var(--awriq-surface)', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }} className="agent-sidebar-right">
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--awriq-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: 'var(--awriq-text)' }}>
                <Shield size={16} color="#C58A3A" /> طلبات الموافقة
              </div>
            </div>
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {approvals.filter(a => a.status === 'pending').map((approval) => (
                <div key={approval.id} className="awriq-card" style={{ padding: '14px', border: '1px solid rgba(197,138,58,0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <AlertTriangle size={14} color="#C58A3A" />
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#C58A3A' }}>{approval.risk_level === 'high' ? 'خطر عالي' : approval.risk_level === 'critical' ? 'حرج' : 'خطر متوسط'}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--awriq-text)', margin: '0 0 8px', lineHeight: 1.5 }}>{approval.description}</p>
                  {approval.files_affected && Array.isArray(approval.files_affected) && approval.files_affected.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '8px' }}>
                      {approval.files_affected.map((f, i) => (
                        <span key={i} style={{ fontSize: '11px', fontFamily: 'monospace', direction: 'ltr', textAlign: 'left', color: 'var(--awriq-secondary)' }}>{f}</span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: '11px', color: '#8A5A2B', marginBottom: '10px' }}>{approval.expires_at ? `تنتهي خلال ${formatCountdown(approval.expires_at)}` : 'تنتهي خلال 10 دقائق'}</div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => reviewApproval(approval, true)} disabled={commitBusy} className="awriq-btn-primary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', fontSize: '11px', padding: '6px' }}>
                      <Check size={12} /> {commitBusy ? '...' : 'موافقة'}
                    </button>
                    <button onClick={() => reviewApproval(approval, false)} disabled={commitBusy} className="awriq-btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', fontSize: '11px', padding: '6px', color: '#C94B4B', borderColor: 'rgba(201,75,75,0.4)' }}>
                      <XCircle size={12} /> رفض
                    </button>
                  </div>
                </div>
              ))}
              {approvals.filter(a => a.status === 'pending').length > 0 && (
                <button onClick={() => reviewAllApprovals(true)} disabled={commitBusy} className="awriq-btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', fontSize: '11px', padding: '8px' }}>
                  <Check size={12} /> الموافقة على الكل
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}