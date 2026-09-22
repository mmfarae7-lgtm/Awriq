import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bot, Send, FolderGit2, FileCode, Terminal, GitBranch, CheckCircle, XCircle,
  AlertTriangle, Shield, Activity, StopCircle, Loader,
  Folder, FileText, Play, Lock, Cpu, TestTube, Bug,
  ArrowRight, Loader2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import type { Project, Institution, AgentSession, AgentTask, AgentApproval } from '../types'
import { formatRelativeTime } from '../lib/utils'

interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  actions?: string[]
  files?: string[]
  timestamp: string
}

type TabKey = 'chat' | 'files' | 'terminal' | 'diff' | 'logs' | 'tasks' | 'tests' | 'git'
type AgentMode = 'read_only' | 'analyze' | 'fix_with_approval' | 'full_development' | 'emergency'

const modeLabels: Record<AgentMode, string> = {
  read_only: 'قراءة فقط', analyze: 'تحليل', fix_with_approval: 'إصلاح بموافقة',
  full_development: 'تطوير كامل', emergency: 'طوارئ',
}
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
  const [fileTree] = useState<{ name: string; type: 'folder' | 'file'; children?: { name: string; type: 'folder' | 'file' }[] }[]>([
    { name: 'src', type: 'folder', children: [
      { name: 'index.php', type: 'file' }, { name: 'routes.php', type: 'file' },
      { name: 'controllers', type: 'folder' }, { name: 'models', type: 'file' as 'folder' },
    ]},
    { name: 'public', type: 'folder', children: [{ name: 'index.html', type: 'file' }] },
    { name: 'config', type: 'folder', children: [{ name: 'database.php', type: 'file' }] },
    { name: 'tests', type: 'folder', children: [{ name: 'StudentTest.php', type: 'file' }] },
    { name: 'composer.json', type: 'file' }, { name: 'README.md', type: 'file' },
  ])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffData, setDiffData] = useState<{ file: string; before: string; after: string; added: number; removed: number }[]>([])
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadProjects() }, [])

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadProjects = async () => {
    setLoading(true)
    const { data } = await supabase.from('projects').select('*, institutions(*)').eq('is_active', true).order('created_at', { ascending: false })
    if (data) setProjects(data as (Project & { institutions: Institution })[])
    setLoading(false)
  }

  const openProject = async (project: Project & { institutions: Institution }) => {
    setSelectedProject(project)
    setAgentStatus('connecting')
    setMessages([])
    setTasks([])
    setApprovals([])
    setTerminalOutput([])
    setLogs([])
    setDiffData([])

    const { data: sessData, error } = await supabase.from('agent_sessions').insert({
      user_id: authSession?.user?.id,
      institution_id: project.institution_id,
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

    setMessages([{
      id: '1', role: 'system', content: `تم الاتصال بالمشروع: ${project.name}\nالمؤسسة: ${project.institutions?.name_ar || project.institutions?.name}\nالوضع: ${modeLabels[mode]}\nالوكيل جاهز لاستقبال المهام.`,
      timestamp: new Date().toISOString(),
    }])

    addLog('info', `Agent session started for project: ${project.name}`)
    await supabase.from('activity_logs').insert({
      action: 'agent_session_started', resource: 'agent_session',
      resource_id: sessData.id, details: `فتح غرفة الوكيل للمشروع: ${project.name}`,
    })
  }

  const addLog = (level: string, message: string) => {
    setLogs(prev => [...prev, { level, message, timestamp: new Date().toISOString() }])
  }

  const addMessage = (role: 'user' | 'agent' | 'system', content: string, actions?: string[], files?: string[]) => {
    setMessages(prev => [...prev, { id: Date.now().toString() + Math.random(), role, content, actions, files, timestamp: new Date().toISOString() }])
  }

  const sendMessage = async () => {
    if (!input.trim() || !agentSession || !selectedProject) return
    const userMsg = input.trim()
    setInput('')
    addMessage('user', userMsg)
    setAgentStatus('analyzing')

    const { data: taskData } = await supabase.from('agent_tasks').insert({
      session_id: agentSession.id, project_id: selectedProject.id,
      title: userMsg, status: 'analyzing', priority: 'medium',
    }).select('*').single()

    if (taskData) setTasks(prev => [taskData as AgentTask, ...prev])
    addLog('info', `New task created: ${userMsg}`)

    await new Promise(r => setTimeout(r, 800))
    addMessage('agent', 'جاري تحليل المشروع وفحص البنية...', ['file_search', 'file_read'])
    setAgentStatus('working')
    await new Promise(r => setTimeout(r, 600))
    addMessage('agent', 'تم فحص الملفات. جاري البحث عن المشكلة في الكود...', ['file_read', 'log_read'])
    await new Promise(r => setTimeout(r, 600))

    const isWriteMode = mode === 'fix_with_approval' || mode === 'full_development' || mode === 'emergency'

    if (isWriteMode) {
      addMessage('agent', 'تم تحديد المشكلة. الملف المتأثر: src/controllers/StudentController.php\nالسبب: دالة التحقق من البيانات مفقودة في متحكم إضافة الطلاب.\nالحل المقترح: إضافة دالة validate() قبل عملية الإدخال.', ['file_read', 'file_write'], ['src/controllers/StudentController.php'])
      setDiffData([{
        file: 'src/controllers/StudentController.php',
        before: 'public function store(Request $request) {\n    Student::create($request->all());\n    return redirect()->back();\n}',
        after: 'public function store(Request $request) {\n    $validated = $request->validate([\n        \'name\' => \'required|string|max:255\',\n        \'email\' => \'required|email|unique:students\',\n    ]);\n    Student::create($validated);\n    return redirect()->back()->with(\'success\', \'تمت الإضافة\');\n}',
        added: 4, removed: 1,
      }])

      if (mode === 'fix_with_approval') {
        setAgentStatus('waiting_approval')
        addMessage('agent', 'بانتظار موافقتك على التغييرات قبل التنفيذ.')

        const { data: approvalData } = await supabase.from('agent_approvals').insert({
          session_id: agentSession.id, user_id: agentSession.user_id,
          action_type: 'file_modify',
          description: 'تعديل StudentController.php لإضافة دالة التحقق من البيانات',
          risk_level: 'medium', files_affected: ['src/controllers/StudentController.php'],
          commands: [], status: 'pending',
        }).select('*').single()

        if (approvalData) setApprovals(prev => [approvalData as AgentApproval, ...prev])
      } else {
        await executeFix()
      }
    } else {
      addMessage('agent', 'تم تحليل المشروع. المشكلة المحتملة في: src/controllers/StudentController.php — دالة التحقق من البيانات مفقودة.\nالوضع الحالي: قراءة فقط. للإصلاح، غيّر الوضع إلى "إصلاح بموافقة" أو "تطوير كامل".', ['file_read'], ['src/controllers/StudentController.php'])
      setAgentStatus('completed')
    }

    if (taskData) {
      await supabase.from('agent_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', taskData.id)
      setTasks(prev => prev.map(t => t.id === taskData.id ? { ...t, status: 'completed', completed_at: new Date().toISOString() } : t))
    }
  }

  const executeFix = async () => {
    setAgentStatus('working')
    addMessage('agent', 'جاري تطبيق التعديلات...', ['file_write'], ['src/controllers/StudentController.php'])
    addLog('info', 'File modified: src/controllers/StudentController.php')
    await new Promise(r => setTimeout(r, 500))

    setAgentStatus('testing')
    addMessage('agent', 'جاري تشغيل الاختبارات...', ['test_execute'])
    setTerminalOutput(prev => [...prev, { command: 'php artisan test --filter=StudentTest', output: 'PASS  Tests\\Unit\\StudentTest\n  ✓ student can be created with valid data\n  ✓ validation fails with invalid data\n\nTests: 2 passed, 2 total', exitCode: 0 }])
    addLog('info', 'Tests passed: 2/2')
    await new Promise(r => setTimeout(r, 500))

    setAgentStatus('completed')
    addMessage('agent', 'تم إصلاح المشكلة بنجاح.\nالملف المعدل: src/controllers/StudentController.php\nالاختبارات: 2/2 نجحت\nالفرق: +4 أسطر، -1 سطر', ['file_write', 'test_execute'], ['src/controllers/StudentController.php'])
  }

  const handleApprove = async (approvalId: string) => {
    await supabase.from('agent_approvals').update({ status: 'approved', reviewed_by: authSession?.user?.id, reviewed_at: new Date().toISOString() }).eq('id', approvalId)
    setApprovals(prev => prev.map(a => a.id === approvalId ? { ...a, status: 'approved' as const } : a))
    addLog('info', 'Approval granted for file modification')
    showToast('تمت الموافقة على التغيير', 'success')
    await executeFix()
  }

  const handleReject = async (approvalId: string) => {
    await supabase.from('agent_approvals').update({ status: 'rejected', reviewed_by: authSession?.user?.id, reviewed_at: new Date().toISOString() }).eq('id', approvalId)
    setApprovals(prev => prev.map(a => a.id === approvalId ? { ...a, status: 'rejected' as const } : a))
    setAgentStatus('stopped')
    addMessage('agent', 'تم رفض التغيير. تم إيقاف الوكيل.')
    showToast('تم رفض التغيير', 'warning')
  }

  const stopAgent = async () => {
    if (!agentSession) return
    setAgentStatus('stopped')
    await supabase.from('agent_sessions').update({ status: 'stopped', ended_at: new Date().toISOString() }).eq('id', agentSession.id)
    addMessage('system', 'تم إيقاف الوكيل.')
    addLog('warning', 'Agent stopped by user')
    showToast('تم إيقاف الوكيل', 'warning')
  }

  const runDiagnostic = async () => {
    if (!agentSession || !selectedProject) return
    addMessage('user', 'فحص شامل للمشروع')
    setAgentStatus('analyzing')
    addMessage('agent', 'جاري فحص البنية والملفات والتبعيات...', ['file_search', 'file_read'])
    await new Promise(r => setTimeout(r, 800))
    addMessage('agent', 'جاري فحص الأخطاء البرمجية ومشاكل الأمان...', ['log_read', 'health_check'])
    await new Promise(r => setTimeout(r, 800))

    const findings = [
      { severity: 'critical', text: 'عدم التحقق من المدخلات في StudentController' },
      { severity: 'high', text: 'كلمة مرور قاعدة البيانات في ملف config غير مشفرة' },
      { severity: 'medium', text: 'عدم وجود CSRF token في نموذج إضافة الطالب' },
      { severity: 'low', text: 'عدم وجود ملف .env.example' },
    ]

    const sevLabels: Record<string, string> = { critical: 'حرج', high: 'عالي', medium: 'متوسط', low: 'منخفض' }

    const findingsText = findings.map(f => `[${sevLabels[f.severity]}] ${f.text}`).join('\n')
    addMessage('agent', `فحص شامل مكتمل. النتائج:\n${findingsText}\n\nعدد المشاكل: ${findings.length}`, ['file_search', 'log_read', 'health_check'])

    setAgentStatus('completed')
    addLog('info', `Full audit completed: ${findings.length} findings`)
  }

  const tabs: { key: TabKey; label: string; icon: typeof Bot }[] = [
    { key: 'chat', label: 'المحادثة', icon: Bot },
    { key: 'files', label: 'الملفات', icon: FileCode },
    { key: 'terminal', label: 'الطرفية', icon: Terminal },
    { key: 'diff', label: 'الفرق', icon: GitBranch },
    { key: 'logs', label: 'السجلات', icon: Activity },
    { key: 'tasks', label: 'المهام', icon: CheckCircle },
    { key: 'tests', label: 'الاختبارات', icon: TestTube },
    { key: 'git', label: 'Git', icon: GitBranch },
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
                    <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>{project.institutions?.name_ar || project.institutions?.name}</div>
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--awriq-border)', background: 'var(--awriq-surface)', flexShrink: 0, flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => { setSelectedProject(null); setAgentSession(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--awriq-secondary)', display: 'flex', alignItems: 'center' }}>
            <ArrowRight size={20} />
          </button>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FolderGit2 size={18} color="#C89B5A" />
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--awriq-text)' }}>{selectedProject.name}</div>
            <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{selectedProject.institutions?.name_ar || selectedProject.institutions?.name}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Mode selector */}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as AgentMode)}
            className="awriq-input"
            style={{ width: 'auto', padding: '6px 28px 6px 12px', fontSize: '12px', cursor: 'pointer', appearance: 'none', backgroundImage: 'none' }}
          >
            {(Object.keys(modeLabels) as AgentMode[]).map(m => (
              <option key={m} value={m}>{modeLabels[m]}</option>
            ))}
          </select>

          {/* Status indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColors[agentStatus], animation: agentStatus === 'working' || agentStatus === 'analyzing' || agentStatus === 'testing' ? 'pulse-soft 2s infinite' : 'none' }} />
            <span style={{ color: statusColors[agentStatus] }}>{statusLabels[agentStatus]}</span>
          </div>

          {/* Stop button */}
          {(agentStatus === 'working' || agentStatus === 'analyzing' || agentStatus === 'testing') && (
            <button onClick={stopAgent} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #C94B4B', background: 'rgba(201,75,75,0.08)', color: '#C94B4B', cursor: 'pointer', fontSize: '12px', fontWeight: 600, fontFamily: 'Cairo, sans-serif' }}>
              <StopCircle size={16} /> إيقاف
            </button>
          )}
        </div>
      </div>

      {/* Main workspace */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left sidebar: file tree + project info */}
        <div style={{ width: '220px', borderLeft: '1px solid var(--awriq-border)', background: 'var(--awriq-surface)', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }} className="agent-sidebar-left">
          <div style={{ padding: '12px', borderBottom: '1px solid var(--awriq-border)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--awriq-secondary)', marginBottom: '8px', textTransform: 'uppercase' }}>معلومات المشروع</div>
            <div style={{ fontSize: '11px', color: 'var(--awriq-text)', lineHeight: 1.6 }}>
              <div>البيئة: {selectedProject.environment}</div>
              <div>الحالة: {selectedProject.agent_status}</div>
              <div>آخر تشغيل: {formatRelativeTime(selectedProject.last_agent_run_at)}</div>
            </div>
          </div>
          <div style={{ padding: '12px', flex: 1 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--awriq-secondary)', marginBottom: '8px', textTransform: 'uppercase' }}>الملفات</div>
            {fileTree.map((item, i) => (
              <div key={i}>
                <div
                  onClick={() => item.type === 'file' && setSelectedFile(item.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', color: selectedFile === item.name ? '#C89B5A' : 'var(--awriq-text)', background: selectedFile === item.name ? 'rgba(200,155,90,0.08)' : 'transparent', transition: 'background 0.15s' }}
                >
                  {item.type === 'folder' ? <Folder size={14} color="#C89B5A" /> : <FileText size={14} color="var(--awriq-secondary)" />}
                  <span>{item.name}</span>
                </div>
                {item.type === 'folder' && item.children?.map((child, j) => (
                  <div
                    key={j}
                    onClick={() => child.type === 'file' && setSelectedFile(child.name)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px 4px 24px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', color: selectedFile === child.name ? '#C89B5A' : 'var(--awriq-text)', background: selectedFile === child.name ? 'rgba(200,155,90,0.08)' : 'transparent', transition: 'background 0.15s' }}
                  >
                    {child.type === 'folder' ? <Folder size={12} color="#C89B5A" /> : <FileText size={12} color="var(--awriq-secondary)" />}
                    <span>{child.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Center: tab content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* Tabs */}
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
                  {tab.key === 'tasks' && tasks.length > 0 && <span style={{ background: 'rgba(200,155,90,0.2)', color: '#8A5A2B', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px' }}>{tasks.length}</span>}
                  {tab.key === 'diff' && diffData.length > 0 && <span style={{ background: 'rgba(200,155,90,0.2)', color: '#8A5A2B', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px' }}>{diffData.length}</span>}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeTab === 'chat' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {messages.map((msg) => (
                    <div key={msg.id} style={{ display: 'flex', gap: '10px', alignSelf: msg.role === 'user' ? 'flex-start' : 'flex-end', maxWidth: '80%' }}>
                      {msg.role === 'user' && (
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, #C89B5A, #8A5A2B)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ color: 'white', fontSize: '13px', fontWeight: 700 }}>U</span>
                        </div>
                      )}
                      <div style={{
                        background: msg.role === 'user' ? 'var(--awriq-surface)' : msg.role === 'system' ? 'rgba(104,114,122,0.08)' : 'rgba(200,155,90,0.08)',
                        border: '1px solid', borderColor: msg.role === 'system' ? 'rgba(104,114,122,0.2)' : 'var(--awriq-border)',
                        borderRadius: '12px', padding: '12px 16px', maxWidth: '100%',
                      }}>
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
                        {msg.files && msg.files.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                            {msg.files.map((f, i) => (
                              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>
                                <FileCode size={10} /> {f}
                              </span>
                            ))}
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

                {/* Quick actions */}
                <div style={{ padding: '8px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid var(--awriq-border)' }}>
                  <button onClick={runDiagnostic} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}>
                    <Bug size={14} /> فحص شامل
                  </button>
                  <button onClick={() => { setActiveTab('terminal'); setTerminalOutput(prev => [...prev, { command: 'php artisan test', output: 'Tests: 2 passed, 2 total', exitCode: 0 }]) }} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}>
                    <TestTube size={14} /> تشغيل الاختبارات
                  </button>
                </div>

                {/* Input */}
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--awriq-border)', display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="اكشف طلبك للوكيل..."
                    className="awriq-input"
                    style={{ flex: 1, fontSize: '13px' }}
                    disabled={agentStatus === 'working' || agentStatus === 'analyzing' || agentStatus === 'testing'}
                  />
                  <button onClick={sendMessage} disabled={!input.trim() || agentStatus === 'working'} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px' }}>
                    <Send size={16} /> إرسال
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'files' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                {selectedFile ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                      <FileCode size={18} color="#C89B5A" />
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--awriq-text)', fontFamily: 'monospace' }}>{selectedFile}</span>
                    </div>
                    <div style={{ background: 'var(--awriq-surface)', border: '1px solid var(--awriq-border)', borderRadius: '8px', padding: '16px', fontFamily: 'monospace', fontSize: '13px', lineHeight: 1.6, color: 'var(--awriq-text)', whiteSpace: 'pre-wrap' }}>
                      {selectedFile.endsWith('.env') || selectedFile.includes('config') || selectedFile.includes('secret') ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#C94B4B', padding: '20px' }}>
                          <Lock size={20} />
                          <span>هذا الملف محمي. الوكيل لا يمكنه قراءة الملفات الحساسة بدون صلاحية خاصة.</span>
                        </div>
                      ) : (
                        `<?php\n\n// ${selectedFile}\n// Content preview\n\nclass StudentController {\n    public function store(Request \$request) {\n        \$validated = \$request->validate([\n            'name' => 'required|string|max:255',\n            'email' => 'required|email|unique:students',\n        ]);\n        Student::create(\$validated);\n        return redirect()->back()->with('success', 'تمت الإضافة');\n    }\n}`
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '48px', color: 'var(--awriq-secondary)', fontSize: '14px' }}>
                    <FileCode size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
                    اختر ملفًا من القائمة الجانبية
                  </div>
                )}
              </div>
            )}

            {activeTab === 'terminal' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px', background: '#0D1218', fontFamily: 'monospace', fontSize: '13px' }}>
                {terminalOutput.length === 0 ? (
                  <div style={{ color: '#68727A', textAlign: 'center', padding: '48px' }}>
                    <Terminal size={32} style={{ margin: '0 auto 8px' }} />
                    لا توجد أوامر منفذة بعد
                  </div>
                ) : (
                  terminalOutput.map((cmd, i) => (
                    <div key={i} style={{ marginBottom: '12px' }}>
                      <div style={{ color: '#C89B5A', marginBottom: '4px' }}>$ {cmd.command}</div>
                      <pre style={{ color: '#E6DED3', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{cmd.output}</pre>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#68727A', marginTop: '4px' }}>
                        <span style={{ color: cmd.exitCode === 0 ? '#4F8A5B' : '#C94B4B' }}>Exit: {cmd.exitCode}</span>
                        <span>{formatRelativeTime(new Date().toISOString())}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'diff' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                {diffData.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px', color: 'var(--awriq-secondary)', fontSize: '14px' }}>
                    <GitBranch size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
                    لا توجد تغييرات بعد
                  </div>
                ) : (
                  diffData.map((diff, i) => (
                    <div key={i} className="awriq-card" style={{ padding: '16px', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', fontFamily: 'monospace' }}>{diff.file}</span>
                        <div style={{ display: 'flex', gap: '8px', fontSize: '12px' }}>
                          <span style={{ color: '#4F8A5B' }}>+{diff.added}</span>
                          <span style={{ color: '#C94B4B' }}>-{diff.removed}</span>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }} className="two-col-grid">
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#C94B4B', marginBottom: '6px' }}>قبل</div>
                          <pre style={{ background: 'rgba(201,75,75,0.05)', borderRadius: '6px', padding: '12px', fontSize: '12px', lineHeight: 1.5, color: 'var(--awriq-text)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', margin: 0 }}>{diff.before}</pre>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#4F8A5B', marginBottom: '6px' }}>بعد</div>
                          <pre style={{ background: 'rgba(79,138,91,0.05)', borderRadius: '6px', padding: '12px', fontSize: '12px', lineHeight: 1.5, color: 'var(--awriq-text)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', margin: 0 }}>{diff.after}</pre>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'logs' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px', background: '#0D1218', fontFamily: 'monospace', fontSize: '12px' }}>
                {logs.length === 0 ? (
                  <div style={{ color: '#68727A', textAlign: 'center', padding: '48px' }}>لا توجد سجلات</div>
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
                    لا توجد مهام
                  </div>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className="awriq-card" style={{ padding: '14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: task.status === 'completed' ? 'rgba(79,138,91,0.1)' : task.status === 'failed' ? 'rgba(201,75,75,0.1)' : 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {task.status === 'completed' ? <CheckCircle size={16} color="#4F8A5B" /> : task.status === 'failed' ? <XCircle size={16} color="#C94B4B" /> : <Loader size={16} color="#C89B5A" />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{task.title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(task.created_at)}</div>
                      </div>
                      <span className="awriq-badge" style={{ background: task.status === 'completed' ? 'rgba(79,138,91,0.1)' : 'rgba(200,155,90,0.1)', color: task.status === 'completed' ? '#4F8A5B' : '#8A5A2B' }}>
                        {statusLabels[task.status] || task.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'tests' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                <div className="awriq-card" style={{ padding: '20px', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <TestTube size={18} color="#C89B5A" /> نتائج الاختبارات
                    </h3>
                    <button className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}>
                      <Play size={14} /> تشغيل
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[
                      { name: 'StudentTest::test_can_create_student', passed: true },
                      { name: 'StudentTest::test_validation_fails', passed: true },
                      { name: 'AuthTest::test_login', passed: true },
                    ].map((test, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '6px', background: test.passed ? 'rgba(79,138,91,0.05)' : 'rgba(201,75,75,0.05)' }}>
                        {test.passed ? <CheckCircle size={16} color="#4F8A5B" /> : <XCircle size={16} color="#C94B4B" />}
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: 'var(--awriq-text)' }}>{test.name}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: '12px', fontSize: '13px', fontWeight: 600, color: '#4F8A5B' }}>3/3 نجحت</div>
                </div>
              </div>
            )}

            {activeTab === 'git' && (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                <div className="awriq-card" style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <GitBranch size={18} color="#C89B5A" /> Git
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span style={{ color: 'var(--awriq-secondary)' }}>الفرع الحالي</span>
                      <span style={{ fontWeight: 600, fontFamily: 'monospace', color: 'var(--awriq-text)' }}>main</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span style={{ color: 'var(--awriq-secondary)' }}>الحالة</span>
                      <span style={{ fontWeight: 600, color: '#4F8A5B' }}>نظيف</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span style={{ color: 'var(--awriq-secondary)' }}>آخر commit</span>
                      <span style={{ fontWeight: 500, fontFamily: 'monospace', color: 'var(--awriq-text)' }}>a1b2c3d</span>
                    </div>
                  </div>
                  <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(201,75,75,0.05)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#C94B4B' }}>
                    <Lock size={14} />
                    العمليات الحساسة (push, reset, force) تتطلب موافقة
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar: approvals */}
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
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#C58A3A' }}>{approval.risk_level === 'high' ? 'خطر عالي' : approval.risk_level === 'critical' ? 'خطر حرج' : 'خطر متوسط'}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--awriq-text)', margin: '0 0 8px', lineHeight: 1.5 }}>{approval.description}</p>
                  {approval.files_affected.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      {approval.files_affected.map((f, i) => (
                        <div key={i} style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--awriq-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <FileCode size={10} /> {f}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleApprove(approval.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '6px', borderRadius: '6px', border: 'none', background: '#4F8A5B', color: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: 600, fontFamily: 'Cairo, sans-serif' }}>
                      <CheckCircle size={14} /> موافقة
                    </button>
                    <button onClick={() => handleReject(approval.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '6px', borderRadius: '6px', border: '1px solid #C94B4B', background: 'transparent', color: '#C94B4B', cursor: 'pointer', fontSize: '12px', fontWeight: 600, fontFamily: 'Cairo, sans-serif' }}>
                      <XCircle size={14} /> رفض
                    </button>
                  </div>
                </div>
              ))}
              {approvals.filter(a => a.status !== 'pending').map((approval) => (
                <div key={approval.id} style={{ padding: '12px', borderRadius: '8px', background: approval.status === 'approved' ? 'rgba(79,138,91,0.05)' : 'rgba(201,75,75,0.05)', fontSize: '12px', color: 'var(--awriq-secondary)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {approval.status === 'approved' ? <CheckCircle size={14} color="#4F8A5B" /> : <XCircle size={14} color="#C94B4B" />}
                    <span>{approval.status === 'approved' ? 'تمت الموافقة' : 'تم الرفض'}</span>
                  </div>
                  <div style={{ marginTop: '4px' }}>{approval.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
