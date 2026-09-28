import { useState, useEffect } from 'react'
import { Key, Plus, X, Copy, RotateCw, Ban, AlertTriangle, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import type { AccessToken, Project } from '../types'
import { formatDate } from '../lib/utils'

const PROFILE_OPTIONS = [
  { value: 'READ_ONLY', label: 'قراءة فقط', hint: 'read-only — لا يعدّل ولا ينفّذ' },
  { value: 'DEVELOPER', label: 'مطوّر', hint: 'قراءة + كتابة + أوامر (مع موافقات)' },
  { value: 'FULL_AGENT', label: 'وكيل كامل', hint: 'كل شيء بما فيه الاستعادة وإدارة المشروع' },
]

const PROFILE_PERMISSIONS: Record<string, string[]> = {
  READ_ONLY: [
    'files.read', 'files.find', 'git.read', 'logs.read',
    'snapshots.list', 'commands.read', 'provider.read',
    'sessions.create', 'sessions.list', 'sessions.close', 'tokens.read',
  ],
  DEVELOPER: [
    'files.read', 'files.find', 'files.write', 'files.create', 'files.delete', 'files.rename',
    'git.read', 'git.write', 'logs.read',
    'snapshots.create', 'snapshots.list', 'commands.read', 'commands.execute', 'commands.interact',
    'provider.read', 'sessions.create', 'sessions.list', 'sessions.close', 'tokens.read', 'tokens.rotate',
  ],
  FULL_AGENT: [
    'files.read', 'files.find', 'files.write', 'files.create', 'files.delete', 'files.rename',
    'git.read', 'git.write', 'logs.read',
    'snapshots.create', 'snapshots.restore', 'snapshots.list',
    'commands.read', 'commands.execute', 'commands.interact',
    'provider.read', 'sessions.create', 'sessions.list', 'sessions.close',
    'tokens.read', 'tokens.rotate', 'approval.respond', 'project.settings', 'deployment.execute',
  ],
}

const ALL_PERMISSIONS = Array.from(new Set(Object.values(PROFILE_PERMISSIONS).flat())).sort()

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return 'awriq_prj_' + hex
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function AccessTokensPage({ projectId: scopedProjectId }: { projectId?: string } = {}) {
  const { showToast } = useToast()
  const { session } = useAuth()
  const [tokens, setTokens] = useState<(AccessToken & { projects?: { name: string }; institutions?: { name_ar: string | null; name: string } })[]>([])
  const [projects, setProjects] = useState<(Project & { institutions: { name_ar: string | null; name: string } })[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [form, setForm] = useState<{
    project_id: string
    name: string
    environment: string
    expires_in_days: string
    profile: string
    permissions: string[]
  }>({
    project_id: scopedProjectId ?? '', name: '', environment: 'development', expires_in_days: '30',
    profile: 'READ_ONLY', permissions: [...PROFILE_PERMISSIONS.READ_ONLY],
  })

  useEffect(() => { loadTokens() }, [])

  const loadTokens = async () => {
    setLoading(true)
    let query = supabase.from('access_tokens').select('*, projects(name), institutions(name, name_ar)')
    if (scopedProjectId) query = query.eq('project_id', scopedProjectId)
    const { data } = await query.order('created_at', { ascending: false })
    if (data) setTokens(data as typeof tokens)
    const { data: projData } = await supabase.from('projects').select('*, institutions(name, name_ar)').eq('is_active', true)
    if (projData) setProjects(projData as typeof projects)
    setLoading(false)
  }

  const selectProfile = (profile: string) => {
    setForm(prev => ({ ...prev, profile, permissions: [...PROFILE_PERMISSIONS[profile]] }))
  }

  const togglePermission = (perm: string) => {
    setForm(prev => ({ ...prev, permissions: prev.permissions.includes(perm) ? prev.permissions.filter(p => p !== perm) : [...prev.permissions, perm] }))
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.project_id || !form.name) { showToast('يرجى اختيار مشروع وإدخال اسم Token', 'warning'); return }

    const project = projects.find(p => p.id === form.project_id)
    if (!project) { showToast('المشروع غير موجود', 'error'); return }

    const rawToken = generateToken()
    const hash = await hashToken(rawToken)
    const expiresAt = form.expires_in_days ? new Date(Date.now() + parseInt(form.expires_in_days) * 86400000).toISOString() : null

    const { error } = await supabase.from('access_tokens').insert({
      project_id: form.project_id,
      institution_id: project.institution_id,
      name: form.name,
      token_hash: hash,
      token_prefix: rawToken.substring(0, 12) + '...',
      scopes: form.permissions,
      permissions: form.permissions,
      profile: form.profile,
      environment: form.environment,
      created_by: session?.user?.id || null,
      expires_at: expiresAt,
    })

    if (error) { showToast('فشل إنشاء Token: ' + error.message, 'error'); return }

    await supabase.from('activity_logs').insert({
      action: 'access_token_created',
      resource: 'access_token',
      details: `تم إنشاء access token: ${form.name} للمشروع: ${project.name} (${form.profile})`,
    })

    showToast('تم إنشاء Token بنجاح', 'success')
    setCreatedToken(rawToken)
    setShowModal(false)
    setForm({
      project_id: scopedProjectId ?? '', name: '', environment: 'development', expires_in_days: '30',
      profile: 'READ_ONLY', permissions: [...PROFILE_PERMISSIONS.READ_ONLY],
    })
    loadTokens()
  }

  const handleRevoke = async (id: string) => {
    const { error } = await supabase.from('access_tokens').update({ status: 'revoked' }).eq('id', id)
    if (error) { showToast('فشل إبطال Token', 'error'); return }
    await supabase.from('activity_logs').insert({ action: 'access_token_revoked', resource: 'access_token', resource_id: id, details: 'تم إبطال access token' })
    await supabase.from('security_events').insert({ event_type: 'token_revoked', severity: 'medium', description: 'Access token revoked by user' })
    showToast('تم إبطال Token', 'success')
    loadTokens()
  }

  const handleRotate = async (id: string) => {
    const oldToken = tokens.find(t => t.id === id)
    if (!oldToken) return
    const rawToken = generateToken()
    const hash = await hashToken(rawToken)
    const { error } = await supabase.from('access_tokens').update({ status: 'rotated', token_hash: hash, token_prefix: rawToken.substring(0, 12) + '...' }).eq('id', id)
    if (error) { showToast('فشل تدوير Token', 'error'); return }
    const { error: insErr } = await supabase.from('access_tokens').insert({
      project_id: oldToken.project_id, institution_id: oldToken.institution_id, name: oldToken.name,
      token_hash: hash, token_prefix: rawToken.substring(0, 12) + '...',
      scopes: oldToken.permissions ?? oldToken.scopes ?? [],
      permissions: oldToken.permissions ?? oldToken.scopes ?? [],
      profile: oldToken.profile ?? 'READ_ONLY',
      environment: oldToken.environment, created_by: session?.user?.id || null, rotated_from: id,
      expires_at: oldToken.expires_at,
    })
    if (insErr) { showToast('فشل إنشاء Token جديد', 'error'); return }
    showToast('تم تدوير Token بنجاح', 'success')
    setCreatedToken(rawToken)
    loadTokens()
  }

  const statusLabels: Record<string, string> = { active: 'نشط', revoked: 'مبطل', expired: 'منتهي', rotated: 'مُدوّر' }
  const statusColors: Record<string, string> = { active: '#4F8A5B', revoked: '#C94B4B', expired: '#68727A', rotated: '#C58A3A' }
  const profileLabels: Record<string, string> = {
    READ_ONLY: 'قراءة فقط', DEVELOPER: 'مطوّر', FULL_AGENT: 'وكيل كامل',
  }
  const profileColors: Record<string, string> = { READ_ONLY: '#68727A', DEVELOPER: '#4F8A5B', FULL_AGENT: '#C58A3A' }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>Access Tokens</h1>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>
            مفاتيح وصول للمشاريع — تُخزّن كـ SHA-256 فقط، مقيّدة بمشروع واحد لكل Token
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> إنشاء Token
        </button>
      </div>

      {createdToken && (
        <div className="awriq-card" style={{ padding: '20px', marginBottom: '20px', border: '1px solid rgba(200,155,90,0.3)', background: 'rgba(200,155,90,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <AlertTriangle size={20} color="#C58A3A" />
            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--awriq-text)' }}>تم إنشاء Token — احفظه الآن، لن يظهر مرة أخرى</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <code style={{ flex: 1, padding: '10px 14px', background: 'var(--awriq-bg)', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', color: 'var(--awriq-text)', wordBreak: 'break-all' }}>{createdToken}</code>
            <button onClick={() => { navigator.clipboard.writeText(createdToken); showToast('تم نسخ Token', 'success') }} className="awriq-btn-secondary" style={{ padding: '10px' }}>
              <Copy size={18} />
            </button>
            <button onClick={() => setCreatedToken(null)} className="awriq-btn-secondary" style={{ padding: '10px' }}>
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="awriq-card" style={{ overflow: 'hidden' }}>
        {tokens.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <Key size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', marginBottom: '16px' }}>لا توجد Tokens</p>
            <button onClick={() => setShowModal(true)} className="awriq-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={18} /> إنشاء Token
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--awriq-border)', background: 'var(--awriq-bg)' }}>
                  <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الاسم</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>المشروع</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الملف الشخصي</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الصلاحيات</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الانتهاء</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الحالة</th>
                  <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => {
                  const permList = token.permissions ?? token.scopes ?? []
                  return (
                    <tr key={token.id} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{token.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>{token.token_prefix}</div>
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--awriq-text)' }}>{token.projects?.name || '—'}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <span className="awriq-badge" style={{ background: `${profileColors[token.profile ?? 'READ_ONLY']}15`, color: profileColors[token.profile ?? 'READ_ONLY'] }}>
                          {profileLabels[token.profile ?? 'READ_ONLY']}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '200px' }}>
                          {permList.slice(0, 3).map((s, i) => (
                            <span key={i} className="awriq-badge" style={{ background: 'rgba(200,155,90,0.1)', color: '#8A5A2B', fontSize: '10px', padding: '2px 8px' }}>{s}</span>
                          ))}
                          {permList.length > 3 && <span style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>+{permList.length - 3}</span>}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{token.expires_at ? formatDate(token.expires_at) : 'لا ينتهي'}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <span className="awriq-badge" style={{ background: `${statusColors[token.status]}15`, color: statusColors[token.status] }}>
                          {statusLabels[token.status]}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          {token.status === 'active' && (
                            <>
                              <button onClick={() => handleRotate(token.id)} title="تدوير" style={{ background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '6px', padding: '5px', cursor: 'pointer', color: '#C58A3A' }}>
                                <RotateCw size={14} />
                              </button>
                              <button onClick={() => handleRevoke(token.id)} title="إبطال" style={{ background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '6px', padding: '5px', cursor: 'pointer', color: '#C94B4B' }}>
                                <Ban size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--awriq-surface)', borderRadius: '16px', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--awriq-border)', position: 'sticky', top: 0, background: 'var(--awriq-surface)', zIndex: 1 }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0 }}>إنشاء Access Token</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--awriq-secondary)' }}><X size={22} /></button>
            </div>
            <form onSubmit={handleCreate} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>المشروع *</label>
                {scopedProjectId ? (
                  <div style={{ padding: '10px 12px', background: 'var(--awriq-bg)', borderRadius: '8px', fontSize: '13px', fontWeight: 700, color: 'var(--awriq-text)' }}>
                    {projects.find(p => p.id === scopedProjectId)?.name || 'المشروع الحالي'}
                  </div>
                ) : (
                  <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="awriq-input" style={{ cursor: 'pointer' }}>
                    <option value="">اختر المشروع</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>اسم Token *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="awriq-input" placeholder="جلسة CI — بيئة فحص" dir="rtl" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>البيئة</label>
                  <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} className="awriq-input" style={{ cursor: 'pointer' }}>
                    <option value="development">تطوير</option>
                    <option value="staging">تجريبي</option>
                    <option value="production">إنتاج</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>الانتهاء (أيام)</label>
                  <input type="number" value={form.expires_in_days} onChange={(e) => setForm({ ...form, expires_in_days: e.target.value })} className="awriq-input" placeholder="30" dir="ltr" />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '8px', display: 'block' }}>ملف الصلاحيات (الأسلم افتراضيًا)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {PROFILE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => selectProfile(opt.value)}
                      style={{
                        flex: 1, minWidth: '150px', padding: '10px 12px', borderRadius: '8px', textAlign: 'right',
                        border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
                        background: form.profile === opt.value ? 'var(--color-primary)' : 'var(--awriq-surface)',
                        borderColor: form.profile === opt.value ? 'var(--color-primary)' : 'var(--awriq-border)',
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: 700, color: form.profile === opt.value ? 'white' : 'var(--awriq-text)' }}>{opt.label}</div>
                      <div style={{ fontSize: '11px', color: form.profile === opt.value ? 'rgba(255,255,255,0.8)' : 'var(--awriq-secondary)' }}>{opt.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={16} color="#C58A3A" /> الصلاحيات الفعلية
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {ALL_PERMISSIONS.map(perm => (
                    <button
                      key={perm}
                      type="button"
                      onClick={() => togglePermission(perm)}
                      style={{
                        padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                        border: '1px solid', cursor: 'pointer', fontFamily: 'monospace',
                        background: form.permissions.includes(perm) ? 'var(--color-primary)' : 'var(--awriq-surface)',
                        color: form.permissions.includes(perm) ? 'white' : 'var(--awriq-text)',
                        borderColor: form.permissions.includes(perm) ? 'var(--color-primary)' : 'var(--awriq-border)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {perm}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', marginTop: '6px' }}>
                  {form.permissions.length} صلاحية — {profileLabels[form.profile]}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowModal(false)} className="awriq-btn-secondary">إلغاء</button>
                <button type="submit" className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Key size={16} /> إنشاء Token
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}