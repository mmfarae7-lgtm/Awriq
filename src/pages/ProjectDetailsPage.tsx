import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { FolderGit2, Bot, GitBranch, Server, Database, Shield, ArrowLeft, ExternalLink, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Project } from '../types'
import { formatRelativeTime } from '../lib/utils'

const typeLabels: Record<string, string> = { institution: 'مدرسة/معهد', other: 'مشروع آخر', program: 'برنامج', software: 'تطبيق برمجي' }

export default function ProjectDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [integrations, setIntegrations] = useState<{ kind: string; provider_ref: string | null; is_connected: boolean; auth_method: string; last_checked_at: string | null; token_prefix: string | null }[]>([])
  const [sessions, setSessions] = useState<{ id: string; mode: string; created_at: string; lifecycle: string }[]>([])
  const [changes, setChanges] = useState<{ id: string; file_path: string; status: string; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [id])

  const load = async () => {
    if (!id) return
    const [{ data: p }, { data: ints }, { data: sess }, { data: ch }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('project_integrations').select('kind, provider_ref, is_connected, auth_method, last_checked_at, token_prefix'),
      supabase.from('agent_sessions').select('id, mode, created_at, lifecycle').eq('project_id', id).order('created_at', { ascending: false }).limit(6),
      supabase.from('agent_file_changes').select('id, file_path, status, created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(8),
    ])
    if (p) setProject(p as Project)
    if (ints) setIntegrations(ints as typeof integrations)
    if (sess) setSessions(sess as typeof sessions)
    if (ch) setChanges(ch as typeof changes)
    setLoading(false)
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }
  if (!project) {
    return <div style={{ minHeight: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
      <FolderGit2 size={40} color="var(--awriq-border)" />
      <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>المشروع غير موجود أو لا تملك صلاحية الوصول.</p>
      <Link to="/projects" className="awriq-btn-secondary">العودة للمشاريع</Link>
    </div>
  }

  const kindLabels: Record<string, string> = { github: 'GitHub', vercel: 'Vercel', supabase: 'Supabase', ai: 'AI' }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--awriq-secondary)', marginBottom: '16px' }}>
        <Link to="/projects" style={{ color: 'var(--awriq-secondary)', textDecoration: 'none' }}>المشاريع</Link>
        <span>«»</span>
        <span style={{ color: 'var(--awriq-text)', fontWeight: 600 }}>{project.name}</span>
      </div>

      <div className="awriq-card" style={{ padding: '24px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '52px', height: '52px', borderRadius: '12px', background: 'rgba(200,155,90,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FolderGit2 size={26} color="#C89B5A" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--awriq-text)', margin: 0 }}>{project.name}</h1>
                <span className="awriq-badge" style={{ background: 'rgba(200,155,90,0.1)', color: '#C89B5A' }}>{typeLabels[project.project_type] || project.project_type}</span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {project.github_repo && <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'monospace' }}><GitBranch size={13} /> {project.github_repo} ({project.github_branch})</span>}
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><Server size={13} /> آخر نشاط: {project.last_agent_run_at ? formatRelativeTime(project.last_agent_run_at) : '—'}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button onClick={() => { void supabase.from('projects').update({ last_activity_at: new Date().toISOString() }).eq('id', project.id); navigate(`/agent-room?project=${project.id}`) }} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bot size={18} /> فتح الوكيل
            </button>
            {project.repository_url && (
              <a href={project.repository_url} target="_blank" rel="noopener noreferrer" className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ExternalLink size={16} /> المستودع
              </a>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }} className="two-col-grid">
        <div className="awriq-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={16} color="#C89B5A" /> الخدمات والربط
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {integrations.length === 0 && <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)' }}>لا ربط مسجل بعد.</div>}
            {integrations.map((i) => (
              <div key={i.kind} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(200,155,90,0.05)', border: '1px solid var(--awriq-border)' }}>
                {i.is_connected ? <CheckCircle2 size={16} color="#4F8A5B" /> : <XCircle size={16} color="#C94B4B" />}
                <span style={{ fontWeight: 700, color: 'var(--awriq-text)' }}>{kindLabels[i.kind] || i.kind}</span>
                <span style={{ color: 'var(--awriq-secondary)', fontFamily: 'monospace', fontSize: '12px', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.provider_ref || i.token_prefix ? `${i.token_prefix || ''}${i.provider_ref || ''}` : '—'}</span>
                <span style={{ color: i.is_connected ? '#4F8A5B' : '#C94B4B', fontSize: '11px', fontWeight: 600 }}>{i.is_connected ? 'متصل' : 'غير متصل'}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="awriq-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={16} color="#C89B5A" /> جلسات الوكيل
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sessions.length === 0 && <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)' }}>لا جلسات بعد — افتح الوكيل وابدأ.</div>}
            {sessions.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', padding: '8px 0', borderBottom: '1px solid var(--awriq-border)' }}>
                <Bot size={14} color="#8A95A0" />
                <span style={{ flex: 1, color: 'var(--awriq-text)', fontWeight: 600, fontSize: '12px' }}>{s.mode}</span>
                <span style={{ color: 'var(--awriq-secondary)', fontSize: '11px' }}>{formatRelativeTime(s.created_at)}</span>
                <Shield size={13} color={s.lifecycle === 'active' ? '#4F8A5B' : '#68727A'} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="awriq-card" style={{ padding: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={16} color="#C89B5A" /> آخر تغييرات الوكيل
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {changes.length === 0 && <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)' }}>لا تغييرات بعد.</div>}
          {changes.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(200,155,90,0.04)' }}>
              <span className="awriq-badge" style={{ fontSize: '10.5px', background: c.status === 'committed' ? 'rgba(79,138,91,0.12)' : 'rgba(197,138,58,0.12)', color: c.status === 'committed' ? '#4F8A5B' : '#C58A3A' }}>{c.status}</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--awriq-text)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.file_path}</span>
              <span style={{ color: 'var(--awriq-secondary)', fontSize: '11px' }}>{formatRelativeTime(c.created_at)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <button onClick={() => navigate(`/agent-room?project=${project.id}`)} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ArrowLeft size={16} /> العودة للغرفة
        </button>
      </div>
    </div>
  )
}