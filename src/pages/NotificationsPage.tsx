import { useState, useEffect } from 'react'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { Notification } from '../types'
import { formatRelativeTime } from '../lib/utils'

export default function NotificationsPage() {
  const { showToast } = useToast()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => { loadNotifications() }, [])

  const loadNotifications = async () => {
    setLoading(true)
    const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false })
    if (data) setNotifications(data as Notification[])
    setLoading(false)
  }

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
  }

  const markAllAsRead = async () => {
    const unread = notifications.filter(n => !n.is_read)
    if (unread.length === 0) return
    for (const n of unread) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
    }
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    showToast('تم تحديد جميع الإشعارات كمقروءة', 'success')
  }

  const deleteNotification = async (id: string) => {
    await supabase.from('notifications').delete().eq('id', id)
    setNotifications(prev => prev.filter(n => n.id !== id))
    showToast('تم حذف الإشعار', 'success')
  }

  const filtered = filter === 'all' ? notifications : filter === 'unread' ? notifications.filter(n => !n.is_read) : notifications.filter(n => n.type === filter)

  const typeColors: Record<string, string> = {
    error: '#C94B4B', warning: '#C58A3A', success: '#4F8A5B', info: '#8A5A2B', security: '#C94B4B',
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>الإشعارات</h1>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>إدارة الإشعارات المركزية</p>
        </div>
        <button onClick={markAllAsRead} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCheck size={18} /> تحديد الكل كمقروء
        </button>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { value: 'all', label: 'الكل' },
          { value: 'unread', label: 'غير مقروء' },
          { value: 'error', label: 'أخطاء' },
          { value: 'warning', label: 'تحذيرات' },
          { value: 'success', label: 'نجاح' },
          { value: 'security', label: 'أمن' },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            style={{
              padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 600,
              border: '1px solid', cursor: 'pointer', fontFamily: 'Cairo, sans-serif',
              background: filter === f.value ? 'var(--color-primary)' : 'var(--awriq-surface)',
              color: filter === f.value ? 'white' : 'var(--awriq-text)',
              borderColor: filter === f.value ? 'var(--color-primary)' : 'var(--awriq-border)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filtered.length === 0 ? (
          <div className="awriq-card" style={{ padding: '48px', textAlign: 'center' }}>
            <Bell size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>لا توجد إشعارات</p>
          </div>
        ) : (
          filtered.map((notif) => (
            <div key={notif.id} className="awriq-card" style={{ padding: '16px', display: 'flex', alignItems: 'flex-start', gap: '12px', background: notif.is_read ? 'var(--awriq-surface)' : 'rgba(200,155,90,0.04)', borderColor: notif.is_read ? 'var(--awriq-border)' : 'rgba(200,155,90,0.2)' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: `${typeColors[notif.type]}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: typeColors[notif.type] }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--awriq-text)' }}>{notif.title_ar || notif.title}</span>
                  {!notif.is_read && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#C89B5A' }} />}
                </div>
                <p style={{ fontSize: '13px', color: 'var(--awriq-secondary)', margin: '0 0 6px' }}>{notif.message_ar || notif.message}</p>
                <span style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(notif.created_at)}</span>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {!notif.is_read && (
                  <button onClick={() => markAsRead(notif.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--awriq-secondary)', padding: '4px' }} title="تحديد كمقروء">
                    <CheckCheck size={16} />
                  </button>
                )}
                <button onClick={() => deleteNotification(notif.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C94B4B', padding: '4px' }} title="حذف">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
