import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { FolderGit2, Plus, X, GitBranch, Bot, Server, ExternalLink } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { Project } from '../types'
import { formatRelativeTime } from '../lib/utils'

const CATS: { key: string; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'institution', label: 'المدارس والمعاهد' },
  { key: 'other', label: 'مشاريع أخرى' },
  { key: 'programs', label: 'البرامج' },
]

const typeLabels: Record<string, string> = {
  institution: 'مدرسة/معهد',
  other: 'مشروع آخر',
  program: 'برنامج',
  software: 'تطبيق برمجي',
}

const envLabels: Record<string, string> = { development: 'تطوير', staging: 'تجريبي', production: 'إنتاج' }
const envColors: Record<string, string> = { development: '#68727A', staging: '#C58A3A', production: '#C94B4B' }

export default function ProjectsPage() {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const cat = searchParams.get('cat') || 'all'
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    project_type: 'other',
    repository_url: '',
    github_repo: '',
    github_branch: 'main',
    vercel_project: '',
    supabase_project: '',
    environment: 'development',
  })

  useEffect(() => { loadProjects() }, [])

  const loadProjects = async () => {
    setLoading(true)
    const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    if (data) setProjects(data as Project[])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    if (cat === 'all') return projects
    if (cat === 'programs') return projects.filter((p) => p.project_type === 'program' || p.project_type === 'software')
    return projects.filter((p) => p.project_type === cat)
  }, [projects, cat])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { showToast('أدخل اسم المشروع', 'warning'); return }
    const repo = form.github_repo.trim() || (form.repository_url.includes('github.com')
      ? form.repository_url.split('github.com/')[1]?.replace(/\.git$/, '') || null
      : null)
    const { error } = await supabase.from('projects').insert({
      name: form.name.trim(),
      description: form.description.trim() || null,
      project_type: form.project_type,
      repository_url: form.repository_url.trim() || null,
      github_repo: repo,
      github_branch: form.github_branch.trim() || 'main',
      vercel_project: form.vercel_project.trim() || null,
      supabase_project: form.supabase_project.trim() || null,
      environment: form.environment,
      root_path: '/',
    })
    if (error) { showToast('فشل إنشاء المشروع: ' + error.message, 'error'); return }
    showToast('تم إنشاء المشروع بنجاح', 'success')
    setShowModal(false)
    setForm({ name: '', description: '', project_type: 'other', repository_url: '', github_repo: '', github_branch: 'main', vercel_project: '', supabase_project: '', environment: 'development' })
    loadProjects()
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out', maxWidth: '1080px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>المشاريع</h1>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>إدارة وصيانة مشاريعك الحالية والمستقبلية</p>
        </div>
        <button onClick={() => setShowModal(true)} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> مشروع جديد
        </button>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {CATS.map((c) => (
          <button
            key={c.key}
            onClick={() => setSearchParams(c.key === 'all' ? {} : { cat: c.key })}
            style={{
              padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              border: cat === c.key ? '1px solid #C89B5A' : '1px solid var(--awriq-border)',
              background: cat === c.key ? 'rgba(200,155,90,0.12)' : 'transparent',
              color: cat === c.key ? '#C89B5A' : 'var(--awriq-secondary)',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '14px' }} className="inst-grid">
        {filtered.length === 0 ? (
          <div className="awriq-card" style={{ padding: '48px', textAlign: 'center', gridColumn: '1 / -1' }}>
            <FolderGit2 size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', marginBottom: '16px' }}>لا توجد مشاريع في هذا التصنيف</p>
            <button onClick={() => setShowModal(true)} className="awriq-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={18} /> إنشاء مشروع
            </button>
          </div>
        ) : (
          filtered.map((p) => (
            <div key={p.id} className="awriq-card" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <FolderGit2 size={20} color="#C89B5A" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>
                      <span className="awriq-badge" style={{ fontSize: '10.5px', marginLeft: '6px' }}>{typeLabels[p.project_type] || p.project_type}</span>
                      {envLabels[p.environment] && <span style={{ color: envColors[p.environment] }}>{envLabels[p.environment]}</span>}
                    </div>
                  </div>
                </div>
              </div>

              {p.description && <p style={{ fontSize: '12.5px', color: 'var(--awriq-secondary)', margin: 0, lineHeight: 1.5 }}>{p.description}</p>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '12px' }}>
                {p.github_repo && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--awriq-text)' }}>
                    <GitBranch size={13} color="#68727A" /> <span style={{ fontFamily: 'monospace' }}>{p.github_repo}</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--awriq-secondary)' }}>
                  <Server size={13} /> آخر نشاط: {p.last_agent_run_at ? formatRelativeTime(p.last_agent_run_at) : '—'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 'auto' }}>
                <button onClick={() => navigate(`/agent-room?project=${p.id}`)} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 14px', flex: 1, justifyContent: 'center' }}>
                  <Bot size={14} /> فتح الوكيل
                </button>
                <button onClick={() => navigate(`/projects/${p.id}`)} className="awriq-btn-secondary" style={{ fontSize: '12px', padding: '8px 14px' }}>التفاصيل</button>
                {p.repository_url && (
                  <a href={p.repository_url} target="_blank" rel="noopener noreferrer" className="awriq-btn-secondary" style={{ fontSize: '12px', padding: '8px 10px' }}><ExternalLink size={14} /></a>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--awriq-surface)', borderRadius: '16px', width: '100%', maxWidth: '540px', maxHeight: '92vh', overflowY: 'auto', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--awriq-border)', position: 'sticky', top: 0, background: 'var(--awriq-surface)' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0 }}>مشروع جديد</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--awriq-secondary)' }}><X size={22} /></button>
            </div>
            <form onSubmit={handleCreate} style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '5px', display: 'block' }}>اسم المشروع *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="awriq-input" placeholder="Orion / AWRIQ / Orvyn..." />
              </div>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '5px', display: 'block' }}>نوع المشروع</label>
                <select value={form.project_type} onChange={(e) => setForm({ ...form, project_type: e.target.value })} className="awriq-input" style={{ cursor: 'pointer' }}>
                  <option value="institution">مدرسة / معهد</option>
                  <option value="other">مشروع آخر</option>
                  <option value="program">برنامج</option>
                  <option value="software">تطبيق برمجي</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '5px', display: 'block' }}>الوصف</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="awriq-input" rows={2} style={{ resize: 'vertical' }} />
              </div>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '5px', display: 'block' }}>مستودع GitHub (owner/repo)</label>
                <input type="text" value={form.github_repo} onChange={(e) => setForm({ ...form, github_repo: e.target.value })} className="awriq-input" placeholder="mmfarae7-lgtm/orion_aden" dir="ltr" />
                <label style={{ fontSize: '11px', color: 'var(--awriq-secondary)', marginTop: '4px' }}>أو الصق رابط المستودع وسيُستخرج تلقائيًا.</label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '5px', display: 'block' }}>رابط المستودع</label>
                  <input type="text" value={form.repository_url} onChange={(e) => setForm({ ...form, repository_url: e.target.value })} className="awriq-input" placeholder="https://github.com/..." dir="ltr" />
                </div>
                <div>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '5px', display: 'block' }}>الفرع</label>
                  <input type="text" value={form.github_branch} onChange={(e) => setForm({ ...form, github_branch: e.target.value })} className="awriq-input" placeholder="main" dir="ltr" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '5px', display: 'block' }}>مشروع Vercel</label>
                  <input type="text" value={form.vercel_project} onChange={(e) => setForm({ ...form, vercel_project: e.target.value })} className="awriq-input" dir="ltr" />
                </div>
                <div>
                  <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '5px', display: 'block' }}>مشروع Supabase</label>
                  <input type="text" value={form.supabase_project} onChange={(e) => setForm({ ...form, supabase_project: e.target.value })} className="awriq-input" dir="ltr" />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '5px', display: 'block' }}>البيئة</label>
                <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} className="awriq-input" style={{ cursor: 'pointer' }}>
                  <option value="development">تطوير</option>
                  <option value="staging">تجريبي</option>
                  <option value="production">إنتاج</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', paddingTop: '6px' }}>
                <button type="button" onClick={() => setShowModal(false)} className="awriq-btn-secondary">إلغاء</button>
                <button type="submit" className="awriq-btn-primary">إنشاء المشروع</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}