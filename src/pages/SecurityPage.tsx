import { useState, useEffect } from 'react'
import { Shield, ShieldAlert, ShieldCheck, AlertTriangle, Activity, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { SecurityEvent } from '../types'
import { formatRelativeTime } from '../lib/utils'

export default function SecurityPage() {
  const { showToast } = useToast()
  const [events, setEvents] = useState<(SecurityEvent & { institutions?: { name_ar: string | null; name: string } })[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  useEffect(() => { loadEvents() }, [])

  const loadEvents = async () => {
    setLoading(true)
    const { data } = await supabase.from('security_events').select('*, institutions(name, name_ar)').order('created_at', { ascending: false })
    if (data) setEvents(data as typeof events)
    setLoading(false)
  }

  const handleResolve = async (id: string) => {
    const { error } = await supabase.from('security_events').update({ is_resolved: true, resolved_at: new Date().toISOString() }).eq('id', id)
    if (error) { showToast('فشل تحديث الحدث', 'error'); return }
    setEvents(prev => prev.map(e => e.id === id ? { ...e, is_resolved: true, resolved_at: new Date().toISOString() } : e))
    showToast('تم تحديد الحدث كمحلول', 'success')
  }

  const severityLabels: Record<string, string> = { low: 'منخفض', medium: 'متوسط', high: 'عالي', critical: 'حرج' }
  const severityColors: Record<string, string> = { low: '#68727A', medium: '#C58A3A', high: '#C94B4B', critical: '#C94B4B' }

  const filtered = events.filter(e => {
    if (filter === 'all') return true
    if (filter === 'unresolved') return !e.is_resolved
    if (e.severity !== filter) return false
    if (search && !e.description.includes(search) && !e.event_type.includes(search)) return false
    return true
  })

  const stats = {
    total: events.length,
    critical: events.filter(e => e.severity === 'critical').length,
    unresolved: events.filter(e => !e.is_resolved).length,
    resolved: events.filter(e => e.is_resolved).length,
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>الأمان</h1>
        <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>مراقبة الأحداث الأمنية وتنبيهات النظام</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }} className="stats-grid">
        {[
          { label: 'إجمالي الأحداث', value: stats.total, icon: Shield, color: '#8A5A2B' },
          { label: 'أحداث حرجة', value: stats.critical, icon: ShieldAlert, color: '#C94B4B' },
          { label: 'غير محلولة', value: stats.unresolved, icon: AlertTriangle, color: '#C58A3A' },
          { label: 'محلولة', value: stats.resolved, icon: ShieldCheck, color: '#4F8A5B' },
        ].map((s, i) => {
          const Icon = s.icon
          return (
            <div key={i} className="awriq-card" style={{ padding: '16px', textAlign: 'center' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: `${s.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                <Icon size={20} color={s.color} />
              </div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', marginTop: '4px' }}>{s.label}</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--awriq-secondary)' }} />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث في الأحداث..." className="awriq-input" style={{ padding: '9px 14px 9px 40px', fontSize: '13px' }} />
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[
            { value: 'all', label: 'الكل' },
            { value: 'unresolved', label: 'غير محلولة' },
            { value: 'critical', label: 'حرج' },
            { value: 'high', label: 'عالي' },
            { value: 'medium', label: 'متوسط' },
            { value: 'low', label: 'منخفض' },
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
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filtered.length === 0 ? (
          <div className="awriq-card" style={{ padding: '48px', textAlign: 'center' }}>
            <Shield size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>لا توجد أحداث أمنية</p>
          </div>
        ) : (
          filtered.map((event) => (
            <div key={event.id} className="awriq-card" style={{ padding: '16px', display: 'flex', alignItems: 'flex-start', gap: '12px', borderColor: event.is_resolved ? 'var(--awriq-border)' : `${severityColors[event.severity]}40` }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: `${severityColors[event.severity]}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Activity size={18} color={severityColors[event.severity]} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--awriq-text)' }}>{event.description}</span>
                  <span className="awriq-badge" style={{ background: `${severityColors[event.severity]}15`, color: severityColors[event.severity] }}>{severityLabels[event.severity]}</span>
                  {event.is_resolved && <span className="awriq-badge" style={{ background: 'rgba(79,138,91,0.1)', color: '#4F8A5B' }}><ShieldCheck size={12} /> محلول</span>}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace' }}>{event.event_type}</span>
                  {event.institutions && <span>{event.institutions.name_ar || event.institutions.name}</span>}
                  <span>{formatRelativeTime(event.created_at)}</span>
                </div>
              </div>
              {!event.is_resolved && (
                <button onClick={() => handleResolve(event.id)} style={{ background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', fontSize: '12px', color: '#4F8A5B', fontFamily: 'Cairo, sans-serif', flexShrink: 0 }}>
                  تحديد كمحلول
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
