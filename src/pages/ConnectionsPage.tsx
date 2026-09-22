import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Cable, Zap, Clock, CheckCircle, XCircle, RefreshCw, Server } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { Institution, SystemConnection } from '../types'
import { getConnectionStatusInfo, formatRelativeTime } from '../lib/utils'

export default function ConnectionsPage() {
  const { showToast } = useToast()
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [connections, setConnections] = useState<SystemConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState<string | null>(null)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const { data: insts } = await supabase.from('institutions').select('*').order('name_ar')
    if (insts) setInstitutions(insts as Institution[])

    const { data: conns } = await supabase.from('system_connections').select('*')
    if (conns) setConnections(conns as SystemConnection[])

    setLoading(false)
  }

  const testConnection = async (conn: SystemConnection, inst: Institution) => {
    if (!inst.domain) { showToast('لا يوجد رابط للنظام', 'warning'); return }
    setTesting(conn.id)
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/connection-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ url: inst.domain, institution_id: inst.id }),
      })
      const result = await response.json()
      const success = result.success || result.status === 'ok'
      await supabase.from('system_connections').update({
        last_test_at: new Date().toISOString(),
        last_test_success: success,
        last_test_result: success ? 'Connection successful' : result.error || 'Connection failed',
        status: success ? 'active' : 'failed',
      }).eq('id', conn.id)

      await supabase.from('activity_logs').insert({
        action: 'connection_test',
        resource: 'system_connection',
        resource_id: conn.id,
        institution_id: inst.id,
        details: success ? 'اختبار اتصال ناجح' : 'اختبار اتصال فشل',
      })

      showToast(success ? 'تم اختبار الاتصال بنجاح' : 'فشل اختبار الاتصال', success ? 'success' : 'error')
      loadAll()
    } catch {
      showToast('فشل اختبار الاتصال', 'error')
    }
    setTesting(null)
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>الربط والأنظمة</h1>
        <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>إدارة اتصالات الأنظمة المستقلة ومراقبتها</p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }} className="stats-grid">
        {[
          { label: 'إجمالي الأنظمة', value: institutions.length, icon: Server, color: '#8A5A2B' },
          { label: 'متصل', value: institutions.filter(i => i.connection_status === 'connected').length, icon: CheckCircle, color: '#4F8A5B' },
          { label: 'متأخر', value: institutions.filter(i => i.connection_status === 'delayed').length, icon: Clock, color: '#C58A3A' },
          { label: 'غير متصل', value: institutions.filter(i => i.connection_status === 'offline').length, icon: XCircle, color: '#C94B4B' },
        ].map((s, i) => {
          const I = s.icon
          return (
            <div key={i} className="awriq-card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: `${s.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <I size={20} color={s.color} />
              </div>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--awriq-text)' }}>{s.value}</div>
                <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>{s.label}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Connections table */}
      <div className="awriq-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--awriq-border)' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Cable size={18} color="#C89B5A" /> الأنظمة المرتبطة
          </h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--awriq-border)', background: 'var(--awriq-bg)' }}>
                <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>المؤسسة</th>
                <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>System ID</th>
                <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الإصدار</th>
                <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الحالة</th>
                <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>آخر نبض</th>
                <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>آخر اختبار</th>
                <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {institutions.map((inst) => {
                const conn = connections.find(c => c.institution_id === inst.id)
                const statusInfo = getConnectionStatusInfo(inst.connection_status)
                return (
                  <tr key={inst.id} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <Link to={`/institutions/${inst.id}`} style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', textDecoration: 'none' }}>
                        {inst.name_ar || inst.name}
                      </Link>
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: '11px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>{inst.system_id}</td>
                    <td style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{inst.system_version || '—'}</td>
                    <td style={{ padding: '12px 8px' }}>
                      <span className="awriq-badge" style={{ background: `${statusInfo.color}15`, color: statusInfo.color }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusInfo.dotColor }} />
                        {statusInfo.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(inst.last_heartbeat_at)}</td>
                    <td style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>
                      {conn?.last_test_at ? formatRelativeTime(conn.last_test_at) : '—'}
                      {conn?.last_test_success !== null && conn?.last_test_success !== undefined && (
                        <span style={{ marginRight: '6px', color: conn.last_test_success ? '#4F8A5B' : '#C94B4B' }}>
                          {conn.last_test_success ? ' ✓' : ' ✗'}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                      <button
                        onClick={() => conn && testConnection(conn, inst)}
                        disabled={testing === conn?.id || !inst.domain}
                        style={{
                          background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '6px',
                          padding: '5px 10px', cursor: 'pointer', fontSize: '12px',
                          color: 'var(--awriq-text)', fontFamily: 'Cairo, sans-serif',
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          opacity: testing === conn?.id || !inst.domain ? 0.5 : 1,
                        }}
                      >
                        {testing === conn?.id ? <RefreshCw size={13} className="animate-pulse-soft" /> : <Zap size={13} />}
                        اختبار
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
