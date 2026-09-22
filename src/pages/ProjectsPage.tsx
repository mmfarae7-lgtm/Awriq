import { useState, useEffect } from 'react'
import { FolderGit2, Plus, X, Server, GitBranch, Activity, Shield, Zap, ExternalLink } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { Project, Institution } from '../types'
import { formatRelativeTime } from '../lib/utils'

export default function ProjectsPage() {
  const { showToast } = useToast()
  const [projects, setProjects] = useState<(Project & { institutions: Institution })[]>([])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ institution_id: '', name: '', description: '', repository_url: '', environment: 'development' })

  useEffect(() => { loadProjects() }, [])

  const loadProjects = async () => {
    setLoading(true)
    const { data } = await supabase.from('projects').select('*, institutions(*)').order('created_at', { ascending: false })
    if (data) setProjects(data as (Project & { institutions: Institution })[])
    const { data: insts } = await supabase.from('institutions').select('*')
    if (insts) setInstitutions(insts as Institution[])
    setLoading(false)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.institution_id || !form.name) { showToast('يرجى اختيار مؤسسة وإدخال اسم المشروع', 'warning'); return }
    const { error } = await supabase.from('projects').insert({
      institution_id: form.institution_id,
      name: form.name,
      description: form.description || null,
      repository_url: form.repository_url || null,
      environment: form.environment,
    })
    if (error) { showToast('فشل إنشاء المشروع: ' + error.message, 'error'); return }
    showToast('تم إنشاء المشروع بنجاح', 'success')
    setShowModal(false)
    setForm({ institution_id: '', name: '', description: '', repository_url: '', environment: 'development' })
    loadProjects()
  }

  const envLabels: Record<string, string> = { development: 'تطوير', staging: 'تجريبي', production: 'إنتاج' }
  const envColors: Record<string, string> = { development: '#68727A', staging: '#C58A3A', production: '#C94B4B' }
  const agentStatusLabels: Record<string, string> = { connected: 'متصل', disconnected: 'غير متصل', connecting: 'جاري الاتصال', error: 'خطأ' }
  const agentStatusColors: Record<string, string> = { connected: '#4F8A5B', disconnected: '#68727A', connecting: '#C58A3A', error: '#C94B4B' }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>المشاريع</h1>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>إدارة مشاريع الأنظمة المرتبطة</p>
        </div>
        <button onClick={() => setShowModal(true)} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> مشروع جديد
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '16px' }} className="inst-grid">
        {projects.length === 0 ? (
          <div className="awriq-card" style={{ padding: '48px', textAlign: 'center', gridColumn: '1 / -1' }}>
            <FolderGit2 size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', marginBottom: '16px' }}>لا توجد مشاريع مسجلة</p>
            <button onClick={() => setShowModal(true)} className="awriq-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={18} /> إنشاء مشروع
            </button>
          </div>
        ) : (
          projects.map((project) => (
            <div key={project.id} className="awriq-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FolderGit2 size={22} color="#C89B5A" />
                  </div>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)' }}>{project.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>{project.institutions?.name_ar || project.institutions?.name || '—'}</div>
                  </div>
                </div>
                <span className="awriq-badge" style={{ background: `${envColors[project.environment]}15`, color: envColors[project.environment] }}>
                  {envLabels[project.environment]}
                </span>
              </div>

              {project.description && <p style={{ fontSize: '13px', color: 'var(--awriq-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>{project.description}</p>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--awriq-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}><Server size={14} /> حالة الوكيل</span>
                  <span style={{ fontWeight: 600, color: agentStatusColors[project.agent_status] }}>{agentStatusLabels[project.agent_status]}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--awriq-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}><Activity size={14} /> آخر تشغيل</span>
                  <span style={{ fontWeight: 500, color: 'var(--awriq-text)' }}>{formatRelativeTime(project.last_agent_run_at)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--awriq-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}><Zap size={14} /> آخر نشر</span>
                  <span style={{ fontWeight: 500, color: 'var(--awriq-text)' }}>{formatRelativeTime(project.last_deployment_at)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--awriq-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}><Shield size={14} /> البناء</span>
                  <span style={{ fontWeight: 600, color: project.build_status === 'pass' ? '#4F8A5B' : project.build_status === 'fail' ? '#C94B4B' : '#68727A' }}>{project.build_status || 'غير معروف'}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {project.repository_url && (
                  <a href={project.repository_url} target="_blank" rel="noopener noreferrer" className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}>
                    <GitBranch size={14} /> المستودع
                  </a>
                )}
                {project.institutions?.domain && (
                  <a href={project.institutions.domain} target="_blank" rel="noopener noreferrer" className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}>
                    <ExternalLink size={14} /> النظام
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--awriq-surface)', borderRadius: '16px', width: '100%', maxWidth: '500px', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--awriq-border)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0 }}>مشروع جديد</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--awriq-secondary)' }}><X size={22} /></button>
            </div>
            <form onSubmit={handleCreate} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>المؤسسة *</label>
                <select value={form.institution_id} onChange={(e) => setForm({ ...form, institution_id: e.target.value })} className="awriq-input" style={{ cursor: 'pointer' }}>
                  <option value="">اختر المؤسسة</option>
                  {institutions.map(i => <option key={i.id} value={i.id}>{i.name_ar || i.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>اسم المشروع *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="awriq-input" placeholder="Orion Institute Management System" />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>الوصف</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="awriq-input" rows={2} placeholder="وصف المشروع" style={{ resize: 'vertical' }} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>رابط المستودع</label>
                <input type="text" value={form.repository_url} onChange={(e) => setForm({ ...form, repository_url: e.target.value })} className="awriq-input" placeholder="https://github.com/..." dir="ltr" />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>البيئة</label>
                <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} className="awriq-input" style={{ cursor: 'pointer' }}>
                  <option value="development">تطوير</option>
                  <option value="staging">تجريبي</option>
                  <option value="production">إنتاج</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
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
