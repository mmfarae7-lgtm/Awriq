import { useState, useEffect } from 'react'
import { Search, Plus, CheckCircle, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import type { UserProfile, Role } from '../types'
import { formatDate } from '../lib/utils'

export default function UsersPage() {
  const { showToast } = useToast()
  const { roles: currentUserRoles } = useAuth()
  const [users, setUsers] = useState<(UserProfile & { email?: string; roles: Role[] })[]>([])
  const [allRoles, setAllRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ email: '', password: '', fullName: '', roleId: '' })

  const canManage = currentUserRoles.some(r => r.name === 'super_admin' || r.name === 'central_admin')

  useEffect(() => { loadUsers() }, [])

  const loadUsers = async () => {
    setLoading(true)
    const { data: profiles } = await supabase.from('user_profiles').select('*')
    const { data: userRoles } = await supabase.from('user_roles').select('user_id, roles(*)')
    const { data: rolesData } = await supabase.from('roles').select('*')
    if (rolesData) setAllRoles(rolesData as Role[])

    if (profiles) {
      const usersWithRoles = (profiles as UserProfile[]).map(p => {
        const roles = (userRoles || []).filter(ur => ur.user_id === p.user_id).map(ur => ur.roles as unknown as Role)
        return { ...p, roles }
      })
      setUsers(usersWithRoles)
    }
    setLoading(false)
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addForm.email || !addForm.password || !addForm.fullName) { showToast('يرجى ملء جميع الحقول', 'warning'); return }
    if (addForm.password.length < 6) { showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'warning'); return }

    const { data, error } = await supabase.auth.admin.createUser({
      email: addForm.email,
      password: addForm.password,
      email_confirm: true,
    })

    if (error) {
      showToast('فشل إنشاء المستخدم: ' + error.message, 'error')
      return
    }

    if (data.user) {
      await supabase.from('user_profiles').insert({
        user_id: data.user.id,
        full_name: addForm.fullName,
        is_active: true,
      })

      if (addForm.roleId) {
        await supabase.from('user_roles').insert({
          user_id: data.user.id,
          role_id: addForm.roleId,
        })
      }

      await supabase.from('activity_logs').insert({
        action: 'user_created',
        resource: 'user',
        resource_id: data.user.id,
        details: `تم إنشاء مستخدم جديد: ${addForm.fullName}`,
      })

      showToast('تم إنشاء المستخدم بنجاح', 'success')
      setShowAddModal(false)
      setAddForm({ email: '', password: '', fullName: '', roleId: '' })
      loadUsers()
    }
  }

  const toggleUserActive = async (userId: string, current: boolean) => {
    await supabase.from('user_profiles').update({ is_active: !current }).eq('user_id', userId)
    setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, is_active: !current } : u))
    showToast(!current ? 'تم تفعيل المستخدم' : 'تم تعطيل المستخدم', !current ? 'success' : 'warning')
  }

  const filtered = users.filter(u => {
    if (!search) return true
    const q = search.toLowerCase()
    return (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
  })

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>المستخدمون</h1>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>إدارة مستخدمي النظام المركزي والأدوار</p>
        </div>
        {canManage && (
          <button onClick={() => setShowAddModal(true)} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> إضافة مستخدم
          </button>
        )}
      </div>

      {/* Search */}
      <div className="awriq-card" style={{ padding: '16px', marginBottom: '20px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--awriq-secondary)' }} />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث في المستخدمين..." className="awriq-input" style={{ padding: '9px 14px 9px 40px', fontSize: '13px' }} />
        </div>
      </div>

      {/* Users table */}
      <div className="awriq-card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--awriq-border)', background: 'var(--awriq-bg)' }}>
                <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>المستخدم</th>
                <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الدور</th>
                <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الهاتف</th>
                <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الحالة</th>
                <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>آخر دخول</th>
                {canManage && <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #C89B5A 0%, #8A5A2B 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>
                        {(user.full_name || 'U').charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{user.full_name || 'بدون اسم'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{user.email || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    {user.roles.map((role, i) => (
                      <span key={i} className="awriq-badge" style={{ background: role.name === 'super_admin' ? 'rgba(201,75,75,0.1)' : role.name === 'central_admin' ? 'rgba(138,90,43,0.1)' : 'rgba(104,114,122,0.1)', color: role.name === 'super_admin' ? '#C94B4B' : role.name === 'central_admin' ? '#8A5A2B' : '#68727A', marginLeft: '4px' }}>
                        {role.name_ar}
                      </span>
                    ))}
                    {user.roles.length === 0 && <span style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{user.phone || '—'}</td>
                  <td style={{ padding: '12px 8px' }}>
                    <span className="awriq-badge" style={{ background: user.is_active ? 'rgba(79,138,91,0.1)' : 'rgba(201,75,75,0.1)', color: user.is_active ? '#4F8A5B' : '#C94B4B' }}>
                      {user.is_active ? <CheckCircle size={12} /> : <XCircle size={12} />} {user.is_active ? 'نشط' : 'معطل'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{user.last_login_at ? formatDate(user.last_login_at) : '—'}</td>
                  {canManage && (
                    <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                      <button
                        onClick={() => toggleUserActive(user.user_id, user.is_active)}
                        style={{ background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px', color: user.is_active ? '#C94B4B' : '#4F8A5B', fontFamily: 'Cairo, sans-serif' }}
                      >
                        {user.is_active ? 'تعطيل' : 'تفعيل'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add user modal */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--awriq-surface)', borderRadius: '16px', width: '100%', maxWidth: '480px', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--awriq-border)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0 }}>إضافة مستخدم جديد</h2>
            </div>
            <form onSubmit={handleAddUser} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>الاسم الكامل *</label>
                <input type="text" value={addForm.fullName} onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })} className="awriq-input" placeholder="الاسم الكامل" />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>البريد الإلكتروني *</label>
                <input type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} className="awriq-input" placeholder="user@awriq.com" dir="ltr" />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>كلمة المرور *</label>
                <input type="password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} className="awriq-input" placeholder="••••••••" dir="ltr" />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>الدور</label>
                <select value={addForm.roleId} onChange={(e) => setAddForm({ ...addForm, roleId: e.target.value })} className="awriq-input" style={{ cursor: 'pointer' }}>
                  <option value="">بدون دور</option>
                  {allRoles.map(r => <option key={r.id} value={r.id}>{r.name_ar}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="awriq-btn-secondary">إلغاء</button>
                <button type="submit" className="awriq-btn-primary">إنشاء المستخدم</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
