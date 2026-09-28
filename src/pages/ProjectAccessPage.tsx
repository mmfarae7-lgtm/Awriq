import { useState, useEffect } from 'react'
import { FolderGit2, ShieldCheck, Activity, Camera, Key, Clock, XCircle, CheckCircle2, RefreshCw, KeyRound, Rocket, Database, Save, Play, Table2, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import { formatDate, formatRelativeTime } from '../lib/utils'
import type { Project, AgentSession, ProjectSnapshot, ApprovalStatus } from '../types'

type ApprovalRow = {
  id: string
  session_id: string
  action_type: string
  description: string
  risk_level: string
  status: ApprovalStatus
  commands: string[] | null
  files_affected: { path?: string; change_type?: string }[] | null
  expires_at: string | null
  created_at: string
}

type AuditRow = {
  id: string
  action: string
  resource: string | null
  resource_id: string | null
  created_at: string
  metadata: Record<string, unknown> | null
}

type MaskedCreds = {
  has_github: boolean
  github_token_masked: string | null
  has_vercel: boolean
  vercel_token_masked: string | null
  vercel_project_id: string | null
  supabase_project_ref: string | null
  supabase_url: string | null
  has_supabase_anon: boolean
  has_supabase_service: boolean
  datastore_write_enabled: boolean
  auto_deploy: boolean
}

const GATEWAY_URL = 'https://qkedsdzwepgscxzvqphu.functions.supabase.co/project-access'

const TABS = [
  { key: 'overview', label: 'نظرة عامة', icon: FolderGit2 },
  { key: 'sessions', label: 'الجلسات', icon: Activity },
  { key: 'approvals', label: 'الموافقات', icon: ShieldCheck },
  { key: 'snapshots', label: 'اللقطات', icon: Camera },
  { key: 'credentials', label: 'الاعتمادات', icon: KeyRound },
  { key: 'deploys', label: 'النشر', icon: Rocket },
  { key: 'datastore', label: 'البيانات', icon: Database },
  { key: 'logs', label: 'النشاط', icon: Clock },
]

const riskColors: Record<string, string> = { low: '#4F8A5B', medium: '#C58A3A', high: '#C94B4B', critical: '#B3261E' }
const statusLabels: Record<string, string> = { pending: 'في انتظار', approved: 'موافق', rejected: 'مرفوض', denied: 'مرفوض', expired: 'منتهية' }

export default function ProjectAccessPage({ projectId: initialProjectId }: { projectId?: string } = {}) {
  const { showToast } = useToast()
  const { session } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState(initialProjectId ?? '')
  const [tab, setTab] = useState('overview')
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [approvals, setApprovals] = useState<ApprovalRow[]>([])
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([])
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.from('projects').select('*').eq('is_active', true).order('created_at', { ascending: false })
      if (data) {
        setProjects(data as Project[])
        if (!initialProjectId && data.length) setProjectId(data[0].id)
      }
      setLoading(false)
    })()
  }, [])

  const loadAll = async () => {
    if (!projectId) return
    const pid = projectId
    await supabase.rpc('expire_stale_approvals')

    const { data: sess } = await supabase.from('agent_sessions').select('*').eq('project_id', pid).order('started_at', { ascending: false }).limit(100)
    if (sess) setSessions(sess as AgentSession[])

    const sessIds = (sess ?? []).map((s: AgentSession) => s.id)
    if (sessIds.length) {
      const { data: appr } = await supabase
        .from('agent_approvals')
        .select('id, session_id, action_type, description, risk_level, status, commands, files_affected, expires_at, created_at')
        .in('session_id', sessIds).order('created_at', { ascending: false }).limit(100)
      if (appr) setApprovals(appr as ApprovalRow[])
    } else {
      setApprovals([])
    }

    const { data: snap } = await supabase.from('project_snapshots').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(100)
    if (snap) setSnapshots(snap as ProjectSnapshot[])

    const { data: logsData } = await supabase.from('audit_logs').select('id, action, resource, resource_id, created_at, metadata').eq('project_id', pid).order('created_at', { ascending: false }).limit(100)
    if (logsData) setLogs(logsData as AuditRow[])
  }

  useEffect(() => { loadAll() }, [projectId])

  const adminApi = async (path: string, method: 'GET' | 'POST', body?: Record<string, unknown>) => {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) throw new Error('لا توجد جلسة إدارية نشطة')
    const url = `${GATEWAY_URL}/${path}${method === 'GET' ? `?project_id=${encodeURIComponent(projectId)}` : ''}`
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    const r = await res.json().catch(() => ({}))
    if (!r.ok) { throw new Error(r.error?.message || ('فشل طلب البوابة ' + res.status)) }
    return r.data
  }

  const [creds, setCreds] = useState<MaskedCreds | null>(null)
  const [credForm, setCredForm] = useState<Record<string, string>>({})
  const [dsWriteOn, setDsWriteOn] = useState(false)
  const [autoDeployOn, setAutoDeployOn] = useState(true)
  const [savingCreds, setSavingCreds] = useState(false)

  const loadCreds = async () => {
    if (!projectId) return
    try {
      const d = await adminApi('credentials', 'GET')
      setCreds(d.credentials as MaskedCreds)
      setDsWriteOn(!!(d.credentials?.datastore_write_enabled))
      setAutoDeployOn(d.credentials?.auto_deploy !== false)
    } catch { setCreds(null) }
  }

  const saveCreds = async () => {
    if (!projectId) return
    setSavingCreds(true)
    try {
      const payload: Record<string, unknown> = { project_id: projectId, datastore_write_enabled: dsWriteOn, auto_deploy: autoDeployOn }
      for (const [k, v] of Object.entries(credForm)) {
        if (typeof v === 'string' && v.trim() !== '') payload[k] = v.trim()
      }
      const d = await adminApi('credentials', 'POST', payload)
      setCreds(d.credentials)
      setCredForm({})
      showToast('حُفظت الاعتمادات (الأسرار مشفّرة)', 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'فشل حفظ الاعتمادات', 'error')
    } finally { setSavingCreds(false) }
  }

  const [deploys, setDeploys] = useState<Record<string, unknown>[]>([])
  const [deploying, setDeploying] = useState(false)

  const loadDeploys = async () => {
    if (!projectId) return
    try { setDeploys(await adminApi('deploys', 'GET')) } catch { setDeploys([]) }
  }

  const triggerDeploy = async () => {
    if (!projectId) return
    setDeploying(true)
    try {
      await adminApi('deploys', 'POST', { project_id: projectId })
      showToast('أُطلق النشر', 'success')
      loadDeploys()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'فشل إطلاق النشر', 'error')
    } finally { setDeploying(false) }
  }

  const [dsTable, setDsTable] = useState('')
  const [dsRows, setDsRows] = useState<Record<string, unknown>[]>([])
  const [dsCols, setDsCols] = useState<string[]>([])
  const [dsMsg, setDsMsg] = useState('')
  const [dsInsert, setDsInsert] = useState('')
  const [dsBusy, setDsBusy] = useState(false)

  const runDsQuery = async () => {
    if (!projectId || !dsTable.trim()) { showToast('أدخل اسم الجدول', 'warning'); return }
    setDsBusy(true)
    try {
      const d = await adminApi('datastore/query', 'POST', { project_id: projectId, table: dsTable.trim(), limit: 100 })
      const rows = (d.rows ?? []) as Record<string, unknown>[]
      setDsRows(rows)
      setDsCols(rows.length ? Object.keys(rows[0]) : [])
      setDsMsg(`${d.count} صف ${d.note ? ' — ' + d.note : ''}`)
    } catch (e) {
      setDsRows([]); setDsCols([]); setDsMsg('')
      showToast(e instanceof Error ? e.message : 'فشل الاستعلام', 'error')
    } finally { setDsBusy(false) }
  }

  const runDsInsert = async () => {
    if (!projectId || !dsTable.trim()) { showToast('أدخل اسم الجدول', 'warning'); return }
    let rows: unknown
    try { rows = JSON.parse(dsInsert) } catch { showToast('rows بصيغة JSON غير صالحة', 'warning'); return }
    setDsBusy(true)
    try {
      await adminApi('datastore/insert', 'POST', { project_id: projectId, table: dsTable.trim(), rows })
      setDsInsert('')
      showToast('أُدخلت الصفوف', 'success')
      runDsQuery()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'فشل الإدراج', 'error')
    } finally { setDsBusy(false) }
  }

  useEffect(() => {
    if (tab === 'credentials') { loadCreds() }
    if (tab === 'deploys') { loadDeploys() }
  }, [tab, projectId])

  const closeSession = async (id: string) => {
    const { error } = await supabase.from('agent_sessions').update({ status: 'stopped', lifecycle: 'closed', ended_at: new Date().toISOString() }).eq('id', id).eq('project_id', projectId)
    if (error) { showToast('فشل إغلاق الجلسة', 'error'); return }
    showToast('أُغلقت الجلسة', 'success')
    loadAll()
  }

  const review = async (approval: ApprovalRow, allow: boolean) => {
    const { error } = await supabase.from('agent_approvals').update({
      status: allow ? 'approved' : 'denied',
      reviewed_by: session?.user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', approval.id)
    if (error) { showToast('فشل تحديث الموافقة: ' + error.message, 'error'); return }
    if (allow && approval.action_type === 'command_execute') {
      await supabase.from('agent_commands').update({ is_approved: true }).eq('session_id', approval.session_id).is('is_approved', false)
    }
    await supabase.from('activity_logs').insert({
      action: allow ? 'approval_allowed' : 'approval_denied',
      resource: 'agent_approval',
      resource_id: approval.id,
      details: `${allow ? 'تمت الموافقة' : 'تم الرفض'} على: ${approval.description}`,
    })
    showToast(allow ? 'تمت الموافقة' : 'تم الرفض', allow ? 'success' : 'warning')
    loadAll()
  }

  const project = projects.find(p => p.id === projectId)
  const pendingApprovals = approvals.filter(a => a.status === 'pending')

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>Project Access</h1>
        <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: '0 0 16px' }}>وصلات الوصول المقيّدة بالمشروع للوكيل (OpenCode) — جلسات وموافقات ولقطات ونشاط</p>
        {!initialProjectId && (
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="awriq-input" style={{ maxWidth: '360px', cursor: 'pointer' }}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>)}
          </select>
        )}
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {TABS.map(t => {
          const Icon = t.icon
          const count = t.key === 'approvals' ? pendingApprovals.length : null
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: '8px',
                border: '1px solid', cursor: 'pointer', fontSize: '13px', fontWeight: 600, transition: 'all 0.15s',
                background: tab === t.key ? 'var(--color-primary)' : 'var(--awriq-surface)',
                color: tab === t.key ? 'white' : 'var(--awriq-text)',
                borderColor: tab === t.key ? 'var(--color-primary)' : 'var(--awriq-border)',
              }}
            >
              <Icon size={15} />
              {t.label}
              {count !== null && count > 0 && (
                <span style={{ background: tab === t.key ? 'rgba(255,255,255,0.25)' : '#C94B4B', color: 'white', borderRadius: '10px', padding: '0 7px', fontSize: '11px' }}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <div className="awriq-card" style={{ padding: '20px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, margin: '0 0 12px', color: 'var(--awriq-text)' }}>
              <FolderGit2 size={17} color="#C58A3A" /> المشروع
            </h3>
            <div style={{ display: 'grid', gap: '10px', fontSize: '13px' }}>
              <div><span style={{ color: 'var(--awriq-secondary)' }}>الاسم: </span><span style={{ color: 'var(--awriq-text)', fontWeight: 600 }}>{project?.name}</span></div>
              <div><span style={{ color: 'var(--awriq-secondary)' }}>Slug: </span><code style={{ color: 'var(--awriq-text)' }}>{project?.slug}</code></div>
              <div><span style={{ color: 'var(--awriq-secondary)' }}>المستودع: </span><span style={{ color: 'var(--awriq-text)', fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>{project?.repository_url || '—'}</span></div>
              <div><span style={{ color: 'var(--awriq-secondary)' }}>الجذر المسموح: </span><code style={{ color: 'var(--awriq-text)' }}>{project?.root_path || '/'}</code></div>
              <div><span style={{ color: 'var(--awriq-secondary)' }}>الحالة: </span>
                <span className="awriq-badge" style={{ background: 'rgba(79,138,91,0.12)', color: '#4F8A5B' }}>{project?.is_active ? 'نشط' : 'معطّل'}</span>
              </div>
            </div>
          </div>

          <div className="awriq-card" style={{ padding: '20px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, margin: '0 0 12px', color: 'var(--awriq-text)' }}>
              <Key size={17} color="#C58A3A" /> اتصال الوكيل (OpenCode)
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--awriq-secondary)', margin: '0 0 12px', lineHeight: 1.7 }}>
              يصدر التوكن من صفحة Access Tokens بصيغة <code>awriq_prj_…</code> ويُخزَّن SHA-256 فقط. البوابة لا تقبل إلا المشروع المرتبط به ممّا يفرض عزلًا كاملًا.
            </p>
            <code style={{ display: 'block', padding: '12px 14px', background: 'var(--awriq-bg)', borderRadius: '8px', fontSize: '12px', fontFamily: 'monospace', color: 'var(--awriq-text)', direction: 'ltr', textAlign: 'left', whiteSpace: 'pre-wrap' }}>
{`curl ${GATEWAY_URL}/me \\
  -H "Authorization: Bearer awriq_prj_..."`}
            </code>
          </div>
        </div>
      )}

      {tab === 'sessions' && (
        <div className="awriq-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--awriq-text)' }}>جلسات الوكيل</h3>
            <button onClick={loadAll} className="awriq-btn-secondary" style={{ padding: '8px', display: 'flex' }}><RefreshCw size={14} /></button>
          </div>
          {sessions.length === 0 ? (
            <p style={{ color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا جلسات بعد</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--awriq-border)' }}>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>العميل</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>النمط</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>الحالة</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>البدء</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>آخر نشاط</th>
                    <th style={{ textAlign: 'center', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(sess => (
                    <tr key={sess.id} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                      <td style={{ padding: '10px' }}>
                        <div style={{ fontSize: '13px', color: 'var(--awriq-text)' }}>{sess.agent_client || '—'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>{sess.mode}</div>
                      </td>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--awriq-text)' }}>{sess.status}</td>
                      <td style={{ padding: '10px' }}>
                        <span className="awriq-badge" style={{ background: sess.lifecycle === 'active' ? 'rgba(79,138,91,0.12)' : 'rgba(104,114,122,0.12)', color: sess.lifecycle === 'active' ? '#4F8A5B' : '#68727A' }}>
                          {sess.lifecycle}
                        </span>
                      </td>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(sess.started_at)}</td>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{sess.last_activity_at ? formatRelativeTime(sess.last_activity_at) : '—'}</td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        {sess.lifecycle === 'active' && (
                          <button onClick={() => closeSession(sess.id)} title="إغلاق" style={{ background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '6px', padding: '5px', cursor: 'pointer', color: '#C94B4B' }}>
                            <XCircle size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'approvals' && (
        <div style={{ display: 'grid', gap: '12px' }}>
          {approvals.length === 0 && (
            <div className="awriq-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا توجد طلبات موافقة</div>
          )}
          {approvals.map(ap => (
            <div key={ap.id} className="awriq-card" style={{ padding: '16px', border: ap.status === 'pending' ? '1px solid rgba(197,138,58,0.5)' : '1px solid var(--awriq-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--awriq-text)' }}>{ap.action_type}</div>
                  <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', marginTop: '2px' }}>{ap.description}</div>
                  {ap.commands?.length ? (
                    <code style={{ display: 'block', marginTop: '6px', background: 'var(--awriq-bg)', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', color: 'var(--awriq-text)', direction: 'ltr', textAlign: 'left' }}>{ap.commands[0]}</code>
                  ) : null}
                  {ap.files_affected?.length ? (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--awriq-text)', fontFamily: 'monospace' }}>
                      {ap.files_affected.map((f, i) => <div key={i}>• {f.change_type} {f.path}</div>)}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                  <span className="awriq-badge" style={{ background: `${riskColors[ap.risk_level]}15`, color: riskColors[ap.risk_level] }}>
                    {ap.risk_level}
                  </span>
                  <span className="awriq-badge" style={{ background: 'rgba(104,114,122,0.12)', color: '#68727A' }}>{statusLabels[ap.status] || ap.status}</span>
                  {ap.status === 'pending' && ap.expires_at && <span style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>تنتهي {formatRelativeTime(ap.expires_at)}</span>}
                  {ap.status === 'pending' && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => review(ap, true)} className="awriq-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '7px 12px' }}>
                        <CheckCircle2 size={14} /> موافقة
                      </button>
                      <button onClick={() => review(ap, false)} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '7px 12px', background: 'none', border: '1px solid #C94B4B', color: '#C94B4B', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        <XCircle size={14} /> رفض
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'snapshots' && (
        <div className="awriq-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 4px', color: 'var(--awriq-text)' }}>لقطات الحالة</h3>
          <p style={{ fontSize: '12px', color: 'var(--awriq-secondary)', margin: '0 0 14px' }}>
            تُنشأ بواسطة الوكيل عبر `POST /snapshots` (صلاحية snapshots.create) وتسجَّل حالة Git كنقطة مرجعية.
          </p>
          {snapshots.length === 0 ? (
            <p style={{ color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا لقطات بعد</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--awriq-border)' }}>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>المعرّف</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>الملصق</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>الفرع</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>Commit</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>الحالة</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map(sn => (
                    <tr key={sn.id} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                      <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--awriq-text)' }}>{sn.snapshot_id}</td>
                      <td style={{ padding: '10px', fontSize: '13px', color: 'var(--awriq-text)' }}>{sn.label}</td>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{sn.branch || '—'}</td>
                      <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{sn.commit_sha ? sn.commit_sha.slice(0, 10) : '—'}</td>
                      <td style={{ padding: '10px' }}>
                        <span className="awriq-badge" style={{ background: 'rgba(79,138,91,0.12)', color: '#4F8A5B' }}>{sn.status}</span>
                      </td>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{formatDate(sn.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'credentials' && (
        <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <div className="awriq-card" style={{ padding: '20px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, margin: '0 0 ' + '12px', color: 'var(--awriq-text)' }}>
              <KeyRound size={17} color="#C58A3A" /> اعتمادات المشروع
            </h3>
            <div style={{ display: 'grid', gap: '10px' }}>
              {[
                ['github_token', 'GitHub Token (PAT)', 'لتطبيق التغييرات المعتمدة على المستودع'],
                ['vercel_token', 'Vercel Token', 'لإطلاق النشر عبر Vercel'],
                ['vercel_project_id', 'Vercel Project ID', 'معرّف المشروع لدى Vercel'],
                ['supabase_project_ref', 'Supabase Project Ref', 'معرّف مشروع Supabase (البيانات)'],
                ['supabase_url', 'Supabase URL', 'https://<ref>.supabase.co'],
                ['supabase_anon_key', 'Supabase Anon Key', 'مفتاح عام — تُحكم القراءة بقواعد RLS لدى الهدف'],
                ['supabase_service_key', 'Supabase Service Key', 'اختياري — لا يُسلَّم أبدًا للوكيل'],
              ].map(([k, label, hint]) => (
                <div key={k}>
                  <label style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>{label}</label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={credForm[k] ?? ''}
                    onChange={(e) => setCredForm((f) => ({ ...f, [k]: e.target.value }))}
                    placeholder={k === 'github_token' && creds?.github_token_masked ? `محفوظ (${creds.github_token_masked})` : 'لإزالة السر اتركه فارغًا'}
                    className="awriq-input"
                    style={{ marginTop: '4px', width: '100%' }}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', marginTop: '2px' }}>{hint}</div>
                </div>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--awriq-text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={dsWriteOn} onChange={(e) => setDsWriteOn(e.target.checked)} />
                  السماح بكتابة البيانات (datastore write) عبر البوابة
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--awriq-text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={autoDeployOn} onChange={(e) => setAutoDeployOn(e.target.checked)} />
                  نشر تلقائي بعد تطبيق تغييرات Git
                </label>
              </div>
              <button onClick={saveCreds} disabled={savingCreds} className="awriq-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', alignSelf: 'flex-start' }}>
                <Save size={14} /> {savingCreds ? 'جاري الحفظ...' : 'حفظ الاعتمادات'}
              </button>
            </div>
          </div>
          <div className="awriq-card" style={{ padding: '20px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, margin: '0 0 ' + '12px', color: 'var(--awriq-text)' }}>
              <ShieldCheck size={17} color="#C58A3A" /> الحالة المشفّرة
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--awriq-secondary)', margin: '0 0 ' + '12px', lineHeight: 1.7 }}>
              الأسرار تُشفَّر في AWRIQ (AES-256-GCM) بمفتاح لا يخرج من الخادم، ويصل الوكيل إلى قدَر محدود فقط عبر البوابة. إفراغ حقل يستبعد السر نهائيًا.
            </p>
            {!creds ? (
              <p style={{ color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا اعتمادات محفوظة لهذا المشروع بعد.</p>
            ) : (
              <div style={{ display: 'grid', gap: '8px', fontSize: '13px' }}>
                <div><KeyRound size={13} style={{ verticalAlign: 'middle', marginLeft: '6px', color: '#4F8A5B' }} /> GitHub: <b>{creds.has_github ? (<span>محفوظ</span>) : 'لا'}</b> {creds.github_token_masked ? <code style={{ fontSize: '11px' }}>{creds.github_token_masked}</code> : null}</div>
                <div><KeyRound size={13} style={{ verticalAlign: 'middle', marginLeft: '6px', color: '#4F8A5B' }} /> Vercel: <b>{creds.has_vercel ? (<span>محفوظ</span>) : 'لا'}</b> {creds.vercel_token_masked ? <code style={{ fontSize: '11px' }}>{creds.vercel_token_masked}</code> : null}</div>
                <div><span style={{ color: 'var(--awriq-secondary)' }}>Vercel Project: </span>{creds.vercel_project_id ? <code style={{ fontSize: '11px' }}>{creds.vercel_project_id}</code> : '—'}</div>
                <div><span style={{ color: 'var(--awriq-secondary)' }}>Supabase Ref: </span>{creds.supabase_project_ref ? <code style={{ fontSize: '11px' }}>{creds.supabase_project_ref}</code> : '—'}</div>
                <div><span style={{ color: 'var(--awriq-secondary)' }}>Supabase URL: </span>{creds.supabase_url ? <code style={{ fontSize: '11px' }}>{creds.supabase_url}</code> : '—'}</div>
                <div><span style={{ color: 'var(--awriq-secondary)' }}>Anon Key: </span>{creds.has_supabase_anon ? 'محفوظ' : 'لا'} · Service Key: {creds.has_supabase_service ? 'محفوظ' : 'لا'}</div>
                <div><span style={{ color: 'var(--awriq-secondary)' }}>كتابة البيانات: </span>{creds.datastore_write_enabled ? <b style={{ color: '#4F8A5B' }}>مفعّلة</b> : 'معطّلة'} · نشر تلقائي: {creds.auto_deploy !== false ? 'نعم' : 'لا'}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'deploys' && (
        <div className="awriq-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--awriq-text)' }}>
              <Rocket size={16} color="#C58A3A" style={{ verticalAlign: 'middle', marginLeft: '6px' }} /> سجل النشر
            </h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={loadDeploys} className="awriq-btn-secondary" style={{ padding: '8px', display: 'flex' }}><RefreshCw size={14} /></button>
              <button onClick={triggerDeploy} disabled={deploying} className="awriq-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Play size={14} /> {deploying ? 'جاري الإطلاق...' : 'إطلاق نشر'}
              </button>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--awriq-secondary)', margin: '0 0 ' + '14px', lineHeight: 1.7 }}>
            إذا ضُبطت اعتمادات Vercel يُعاد بناء أحدث إنتاج؛ وإلا يُسجَّل النشر خارجيًا (queued) ويحدث عند الدفع إلى المستودع. قابل للرصد هنا وفارد عبر صلاحية <code>deploy.read</code>.
          </p>
          {deploys.length === 0 ? (
            <p style={{ color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا عمليات نشر مسجّلة بعد.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--awriq-border)' }}>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>المزوّد</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>الحالة</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>الرسالة</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>الرابط</th>
                    <th style={{ textAlign: 'right', padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {deploys.map((d) => (
                    <tr key={String(d.id)} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--awriq-text)' }}>{String(d.provider)}</td>
                      <td style={{ padding: '10px' }}>
                        <span className="awriq-badge" style={{ background: d.status === 'building' || d.status === 'queued' ? 'rgba(197,138,58,0.15)' : d.status === 'error' ? 'rgba(201,75,75,0.15)' : 'rgba(79,138,91,0.12)', color: d.status === 'building' || d.status === 'queued' ? '#C58A3A' : d.status === 'error' ? '#C94B4B' : '#4F8A5B' }}>{String(d.status)}</span></td>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{String(d.message)}</td>
                      <td style={{ padding: '10px' }}>{d.external_url ? <a href={String(d.external_url)} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--color-primary)' }}>فتح ↗</a> : <span style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>—</span>}</td>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(String(d.created_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'datastore' && (
        <div className="awriq-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 ' + '4px', color: 'var(--awriq-text)' }}>
            <Database size={16} color="#C58A3A" style={{ verticalAlign: 'middle', marginLeft: '6px' }} /> مستكشف البيانات
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--awriq-secondary)', margin: '0 0 ' + '14px', lineHeight: 1.7 }}>
            يُنفَّذ عبر بوابة AWRIQ بالمفتاح العام للهدف (Supabase) فتحكم أمانه (RLS) بالقراءة. الجداول المحظورة؛ {''}
            <code>pg_</code> و<code>information_schema</code> و<code>auth.*</code> و<code>storage.*</code> و<code>vault.*</code>. الكتابة تحتاج تفعيل "كتابة البيانات".
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <input value={dsTable} onChange={(e) => setDsTable(e.target.value)} placeholder="اسم الجدول (مثال: profiles)" className="awriq-input" style={{ flex: '1', minWidth: '200px' }} />
            <button onClick={runDsQuery} disabled={dsBusy} className="awriq-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Table2 size={14} /> {dsBusy ? 'جارٍ...' : 'استعلام'}
            </button>
          </div>
          {dsMsg && <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', marginBottom: '10px' }}>{dsMsg}</div>}
          {dsCols.length > 0 ? (
            <div style={{ overflowX: 'auto', marginBottom: '14px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--awriq-border)' }}>
                    {dsCols.map((c) => <th key={c} style={{ textAlign: 'right', padding: '8px', fontSize: '11px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {dsRows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                      {dsCols.map((c) => <td key={c} style={{ padding: '8px', fontSize: '12px', color: 'var(--awriq-text)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(r[c] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <label style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>إدراج صفوف (JSON):</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <textarea value={dsInsert} onChange={(e) => setDsInsert(e.target.value)} placeholder='[{"name":"مثال","value":1}]' className="awriq-input" style={{ flex: '1', minHeight: '46px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical', direction: 'ltr', textAlign: 'left' }} />
            <button onClick={runDsInsert} disabled={dsBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: 'none', border: '1px solid var(--awriq-border)', color: 'var(--awriq-text)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
              <Plus size={14} /> إدراج
            </button>
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="awriq-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 ' + '14px', color: 'var(--awriq-text)' }}>سجل التدقيق لنشاط الوصول</h3>
          {logs.length === 0 ? (
            <p style={{ color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا نشاط مسجّل</p>
          ) : (
            <div style={{ display: 'grid', gap: '8px' }}>
              {logs.map(l => {
                const meta = (l.metadata ?? {}) as Record<string, unknown>
                return (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', background: 'var(--awriq-bg)', borderRadius: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '200px' }}>
                      <ShieldCheck size={14} color="#C58A3A" />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{l.action}</div>
                        <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>{l.resource || ''}{l.resource_id ? ` / ${l.resource_id}` : ''}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {typeof meta.result === 'string' && (
                        <span className="awriq-badge" style={{ background: meta.result === 'success' ? 'rgba(79,138,91,0.12)' : 'rgba(104,114,122,0.12)', color: meta.result === 'success' ? '#4F8A5B' : '#68727A' }}>{meta.result}</span>
                      )}
                      {typeof meta.token_prefix === 'string' && <code style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{meta.token_prefix}</code>}
                      <span style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(l.created_at)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}