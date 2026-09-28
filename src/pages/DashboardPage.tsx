import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Feather, FolderGit2, Bot, GitBranch, Clock, History, GitPullRequest, ArrowLeft, Activity } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Project, AgentSession } from '../types'
import { formatRelativeTime } from '../lib/utils'

const typeLabels: Record<string, string> = {
  institution: 'مدرسة/معهد',
  other: 'مشروع آخر',
  program: 'برنامج',
  software: 'تطبيق برمجي',
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<number>(0)
  const [recentActivity, setRecentActivity] = useState<{ id: string; details: string | null; action: string; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    const [{ data: p }, { data: s }, { count: ap }, { data: a }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('agent_sessions').select('*, projects(name, project_type, github_repo)').order('created_at', { ascending: false }).limit(6),
      supabase.from('agent_approvals').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('activity_logs').select('id, action, details, created_at').order('created_at', { ascending: false }).limit(6),
    ])
    if (p) setProjects(p as Project[])
    if (s) setSessions(s as AgentSession[])
    setPendingApprovals(ap || 0)
    if (a) setRecentActivity(a as typeof recentActivity)
    setLoading(false)
  }

  const activeCount = projects.filter((x) => x.is_active && x.status !== 'disabled').length

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
      <div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div>
    </div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out', maxWidth: '1080px', margin: '0 auto' }}>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
          <Feather size={26} color="#C89B5A" strokeWidth={2} />
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--awriq-text)', margin: 0 }}>
            مرحبًا، {(profile?.full_name_ar || profile?.full_name || 'أوراق').split(' ')[0]}
          </h1>
        </div>
        <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0, paddingRight: '38px' }}>
          مركزك الشخصي لإدارة المشاريع وصيانتها بالوكيل.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }} className="stats-grid">
        {[
          { label: 'مشاريع نشطة', value: activeCount, icon: FolderGit2, color: '#C89B5A' },
          { label: 'جلسات الوكيل', value: sessions.length, icon: Bot, color: '#4F8A5B' },
          { label: 'إجراءات بانتظار موافقتك', value: pendingApprovals, icon: GitPullRequest, color: '#C58A3A' },
        ].map((c) => {
          const Icon = c.icon
          return (
            <div key={c.label} className="awriq-card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: `${c.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={18} color={c.color} />
                </div>
              </div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)' }}>{c.value}</div>
              <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', fontWeight: 500 }}>{c.label}</div>
            </div>
          )
        })}
      </div>

      <div className="awriq-card" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderGit2 size={18} color="#C89B5A" /> المشاريع النشطة
          </h3>
          <button onClick={() => navigate('/projects')} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            كل المشاريع <ArrowLeft size={14} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {projects.length === 0 && <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)', padding: '12px' }}>لا توجد مشاريع بعد — أضف أول مشروع.</div>}
          {projects.slice(0, 5).map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '10px', background: 'rgba(200,155,90,0.06)', border: '1px solid var(--awriq-border)', cursor: 'pointer', transition: 'background 0.2s' }}
            >
              <Bot size={20} color="#C89B5A" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--awriq-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>{typeLabels[p.project_type] || p.project_type}</span>
                  {p.github_repo && <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'monospace' }}><GitBranch size={12} /> {p.github_repo}</span>}
                  {p.last_agent_run_at && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> {formatRelativeTime(p.last_agent_run_at)}</span>}
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); navigate(`/agent-room?project=${p.id}`) }} className="awriq-btn-secondary" style={{ fontSize: '12px', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <Bot size={14} /> فتح الوكيل
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }} className="two-col-grid">
        <div className="awriq-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <History size={16} color="#C89B5A" /> آخر جلسات الوكيل
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sessions.length === 0 && <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)' }}>لا جلسات بعد.</div>}
            {sessions.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', padding: '8px 0', borderBottom: '1px solid var(--awriq-border)' }}>
                <div style={{ flex: 1, color: 'var(--awriq-text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {((s as unknown as { projects: { name: string } }).projects?.name) || 'مشروع'}
                </div>
                <span className="awriq-badge" style={{ fontSize: '11px' }}>{String(s.mode) === 'comprehensive' ? 'تحليل كامل' : String(s.mode) === 'analyze' ? 'تحليل' : String(s.mode) === 'write' ? 'كتابة' : String(s.mode)}</span>
                <span style={{ color: 'var(--awriq-secondary)', fontSize: '11px' }}>{formatRelativeTime(s.created_at)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="awriq-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={16} color="#C89B5A" /> آخر النشاط
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recentActivity.length === 0 && <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)' }}>لا نشاط بعد.</div>}
            {recentActivity.map((a, i) => (
              <div key={a.id || i} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', padding: '8px 0', borderBottom: '1px solid var(--awriq-border)' }}>
                <div style={{ flex: 1, color: 'var(--awriq-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.details || a.action}</div>
                <span style={{ color: 'var(--awriq-secondary)', fontSize: '11px' }}>{formatRelativeTime(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}