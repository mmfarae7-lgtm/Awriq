import { useState, useEffect } from 'react'
import { History, Search, Activity } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { ActivityLog } from '../types'
import { formatRelativeTime } from '../lib/utils'

export default function ActivityLogPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterAction, setFilterAction] = useState('all')

  useEffect(() => { loadLogs() }, [])

  const loadLogs = async () => {
    setLoading(true)
    const { data } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(200)
    if (data) setLogs(data as ActivityLog[])
    setLoading(false)
  }

  const actions = [...new Set(logs.map(l => l.action))]

  const filtered = logs.filter(l => {
    if (search) {
      const q = search.toLowerCase()
      if (!(l.details || '').toLowerCase().includes(q) && !l.action.toLowerCase().includes(q)) return false
    }
    if (filterAction !== 'all' && l.action !== filterAction) return false
    return true
  })

  const actionLabels: Record<string, string> = {
    login: 'تسجيل دخول', logout: 'تسجيل خروج', institution_registered: 'تسجيل مؤسسة',
    institution_updated: 'تعديل مؤسسة', institution_disabled: 'تعطيل مؤسسة', institution_enabled: 'تفعيل مؤسسة',
    connection_test: 'اختبار اتصال', credential_rotation: 'تدوير بيانات اعتماد', permission_change: 'تغيير صلاحية',
    system_connection: 'ربط نظام', security_event: 'حدث أمني', user_created: 'إنشاء مستخدم',
    system_status_check: 'فحص حالة النظام', report_generated: 'تقرير مُنشأ',
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>سجل النشاط</h1>
        <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>سجل كامل لجميع الأنشطة في النظام</p>
      </div>

      {/* Filters */}
      <div className="awriq-card" style={{ padding: '16px', marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '200px', position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--awriq-secondary)' }} />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث في السجل..." className="awriq-input" style={{ padding: '9px 14px 9px 40px', fontSize: '13px' }} />
        </div>
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="awriq-input" style={{ width: 'auto', padding: '9px 14px', fontSize: '13px', cursor: 'pointer' }}>
          <option value="all">كل الإجراءات</option>
          {actions.map(a => <option key={a} value={a}>{actionLabels[a] || a}</option>)}
        </select>
      </div>

      {/* Log list */}
      <div className="awriq-card" style={{ overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <History size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>لا توجد سجلات</p>
          </div>
        ) : (
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {filtered.map((log) => (
              <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderBottom: '1px solid var(--awriq-border)' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Activity size={16} color="#C89B5A" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>
                    {log.details || actionLabels[log.action] || log.action}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>
                    {actionLabels[log.action] || log.action} {log.resource && `• ${log.resource}`} {log.resource_id && `• ${log.resource_id}`}
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', textAlign: 'left', whiteSpace: 'nowrap' }}>
                  {formatRelativeTime(log.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
