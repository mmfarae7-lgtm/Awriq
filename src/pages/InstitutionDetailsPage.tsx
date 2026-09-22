import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowRight, ExternalLink, Star, MapPin, Mail, Phone, Calendar, Server, Hash, Activity, Shield, Clock, Building2, School, GraduationCap, Power, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { Institution, InstitutionAdmin, SystemConnection, Heartbeat, SystemVersion, ActivityLog } from '../types'
import { getConnectionStatusInfo, getInstitutionTypeLabel, formatNumber, formatRelativeTime, formatDate } from '../lib/utils'

export default function InstitutionDetailsPage() {
  const { id } = useParams()
  const { showToast } = useToast()
  const [institution, setInstitution] = useState<Institution | null>(null)
  const [admins, setAdmins] = useState<InstitutionAdmin[]>([])
  const [connections, setConnections] = useState<SystemConnection[]>([])
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([])
  const [versions, setVersions] = useState<SystemVersion[]>([])
  const [activities, setActivities] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (id) loadAll(id)
  }, [id])

  const loadAll = async (instId: string) => {
    setLoading(true)
    const { data: inst } = await supabase.from('institutions').select('*').eq('id', instId).maybeSingle()
    if (inst) setInstitution(inst as Institution)

    const { data: adm } = await supabase.from('institution_admins').select('*').eq('institution_id', instId)
    if (adm) setAdmins(adm as InstitutionAdmin[])

    const { data: conns } = await supabase.from('system_connections').select('*').eq('institution_id', instId)
    if (conns) setConnections(conns as SystemConnection[])

    const { data: hb } = await supabase.from('heartbeats').select('*').eq('institution_id', instId).order('received_at', { ascending: false }).limit(10)
    if (hb) setHeartbeats(hb as Heartbeat[])

    const { data: vers } = await supabase.from('system_versions').select('*').eq('institution_id', instId).order('created_at', { ascending: false })
    if (vers) setVersions(vers as SystemVersion[])

    const { data: acts } = await supabase.from('activity_logs').select('*').eq('institution_id', instId).order('created_at', { ascending: false }).limit(10)
    if (acts) setActivities(acts as ActivityLog[])

    setLoading(false)
  }

  const toggleFavorite = async () => {
    if (!institution) return
    await supabase.from('institutions').update({ is_favorite: !institution.is_favorite }).eq('id', institution.id)
    setInstitution({ ...institution, is_favorite: !institution.is_favorite })
  }

  const toggleStatus = async () => {
    if (!institution) return
    const newStatus = institution.status === 'active' ? 'disabled' : 'active'
    await supabase.from('institutions').update({ status: newStatus }).eq('id', institution.id)
    setInstitution({ ...institution, status: newStatus })
    showToast(newStatus === 'active' ? 'تم تفعيل المؤسسة' : 'تم تعطيل المؤسسة', newStatus === 'active' ? 'success' : 'warning')

    await supabase.from('activity_logs').insert({
      action: newStatus === 'active' ? 'institution_enabled' : 'institution_disabled',
      resource: 'institution',
      resource_id: institution.system_id,
      institution_id: institution.id,
      details: `${newStatus === 'active' ? 'تم تفعيل' : 'تم تعطيل'} ${institution.name_ar || institution.name}`,
    })
  }

  const testConnection = async () => {
    if (!institution || !institution.domain) { showToast('لا يوجد رابط للنظام', 'warning'); return }
    setTesting(true)
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/connection-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ url: institution.domain, institution_id: institution.id }),
      })
      const result = await response.json()
      const success = result.success || result.status === 'ok'
      await supabase.from('system_connections').update({
        last_test_at: new Date().toISOString(),
        last_test_success: success,
        last_test_result: success ? 'Connection successful' : result.error || 'Connection failed',
      }).eq('institution_id', institution.id)

      await supabase.from('activity_logs').insert({
        action: 'connection_test',
        resource: 'system_connection',
        institution_id: institution.id,
        details: success ? 'اختبار الاتصال ناجح' : 'اختبار الاتصال فشل',
      })

      showToast(success ? 'تم اختبار الاتصال بنجاح' : 'فشل اختبار الاتصال', success ? 'success' : 'error')
      if (id) loadAll(id)
    } catch {
      showToast('فشل اختبار الاتصال', 'error')
    }
    setTesting(false)
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  if (!institution) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <h2 style={{ fontSize: '18px', color: 'var(--awriq-text)' }}>المؤسسة غير موجودة</h2>
        <Link to="/institutions" style={{ color: 'var(--color-primary)', fontSize: '14px' }}>العودة للقائمة</Link>
      </div>
    )
  }

  const statusInfo = getConnectionStatusInfo(institution.connection_status)
  const typeIcon = institution.type === 'school' ? School : institution.type === 'institute' ? Building2 : GraduationCap
  const Icon = typeIcon

  const infoItems = [
    { label: 'System ID', value: institution.system_id, icon: Hash },
    { label: 'Tenant ID', value: institution.tenant_id, icon: Hash },
    { label: 'Institution ID', value: institution.institution_id, icon: Hash },
    { label: 'الإصدار', value: institution.system_version || '—', icon: Zap },
    { label: 'المحافظة', value: institution.governorate || '—', icon: MapPin },
    { label: 'المدينة', value: institution.city || '—', icon: MapPin },
    { label: 'البريد', value: institution.contact_email || '—', icon: Mail },
    { label: 'الهاتف', value: institution.contact_phone || '—', icon: Phone },
    { label: 'تاريخ التسجيل', value: formatDate(institution.created_at), icon: Calendar },
    { label: 'آخر نبض', value: formatRelativeTime(institution.last_heartbeat_at), icon: Activity },
    { label: 'آخر مزامنة', value: formatRelativeTime(institution.last_sync_at), icon: Clock },
    { label: 'الحالة', value: institution.status === 'active' ? 'نشط' : 'معطل', icon: Shield },
  ]

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
        <Link to="/institutions" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: 'var(--awriq-secondary)', textDecoration: 'none', fontWeight: 500 }}>
          <ArrowRight size={16} /> المدارس والمعاهد
        </Link>
        <span style={{ color: 'var(--awriq-border)' }}>/</span>
        <span style={{ fontSize: '13px', color: 'var(--awriq-text)', fontWeight: 600 }}>{institution.name_ar || institution.name}</span>
      </div>

      {/* Header card */}
      <div className="awriq-card" style={{ padding: '24px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{
            width: '80px', height: '80px', borderRadius: '16px',
            background: 'linear-gradient(135deg, #1A222B 0%, #242E39 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {institution.logo_url ? <img src={institution.logo_url} alt={institution.name} style={{ width: '100%', height: '100%', borderRadius: '16px', objectFit: 'cover' }} /> : <Icon size={36} color="#C89B5A" />}
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--awriq-text)', margin: 0 }}>{institution.name_ar || institution.name}</h1>
              <span className="awriq-badge" style={{ background: `${statusInfo.color}15`, color: statusInfo.color }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: statusInfo.dotColor }} />
                {statusInfo.label}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--awriq-secondary)', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Building2 size={14} /> {getInstitutionTypeLabel(institution.type)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Server size={14} /> {institution.system_name || '—'}</span>
              {institution.governorate && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={14} /> {institution.governorate}</span>}
              <span style={{ fontFamily: 'monospace' }}>{institution.system_id}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={toggleFavorite} style={{ background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--awriq-text)', fontFamily: 'Cairo, sans-serif', fontSize: '13px' }}>
              <Star size={16} fill={institution.is_favorite ? '#C89B5A' : 'none'} color={institution.is_favorite ? '#C89B5A' : 'currentColor'} />
            </button>
            <button onClick={toggleStatus} style={{ background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: institution.status === 'active' ? '#C94B4B' : '#4F8A5B', fontFamily: 'Cairo, sans-serif', fontSize: '13px' }}>
              <Power size={16} /> {institution.status === 'active' ? 'تعطيل' : 'تفعيل'}
            </button>
            <button onClick={testConnection} disabled={testing} className="awriq-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', opacity: testing ? 0.6 : 1 }}>
              <Zap size={16} /> {testing ? 'جاري الاختبار...' : 'اختبار الاتصال'}
            </button>
            {institution.domain && (
              <a href={institution.domain} target="_blank" rel="noopener noreferrer" className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', textDecoration: 'none' }}>
                <ExternalLink size={16} /> فتح النظام
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Info grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }} className="details-grid">
        {infoItems.map((item, i) => {
          const I = item.icon
          return (
            <div key={i} className="awriq-card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(138,90,43,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <I size={16} color="#8A5A2B" />
                </div>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', fontWeight: 500 }}>{item.label}</div>
                  <div style={{ fontSize: '13px', color: 'var(--awriq-text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: item.label.includes('ID') ? 'monospace' : 'inherit' }}>{item.value}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }} className="stats-grid">
        {[
          { label: 'الطلاب', value: formatNumber(institution.student_count), color: '#4F8A5B' },
          { label: 'المعلمون', value: formatNumber(institution.teacher_count), color: '#8A5A2B' },
          { label: 'النبضات', value: heartbeats.length, color: '#C89B5A' },
          { label: 'الإصدارات', value: versions.length, color: '#68421F' },
        ].map((s, i) => (
          <div key={i} className="awriq-card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', marginTop: '4px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Two columns: Admins + Connections */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }} className="two-col-grid">
        {/* Admins */}
        <div className="awriq-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={18} color="#C89B5A" /> مسؤولو المؤسسة
          </h3>
          {admins.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا يوجد مسؤولون مسجلون</div>
          ) : (
            admins.map((admin) => (
              <div key={admin.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--awriq-border)' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, #C89B5A 0%, #8A5A2B 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>
                  {admin.name.charAt(0)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{admin.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>{admin.email || '—'}</div>
                </div>
                {admin.is_primary && <span className="awriq-badge" style={{ background: 'rgba(79,138,91,0.1)', color: '#4F8A5B' }}>رئيسي</span>}
              </div>
            ))
          )}
        </div>

        {/* Connections */}
        <div className="awriq-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={18} color="#C89B5A" /> معلومات الربط
          </h3>
          {connections.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا يوجد اتصال مسجل</div>
          ) : (
            connections.map((conn) => (
              <div key={conn.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--awriq-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{conn.connection_type.toUpperCase()}</span>
                  <span className="awriq-badge" style={{ background: conn.status === 'active' ? 'rgba(79,138,91,0.1)' : conn.status === 'pending' ? 'rgba(197,138,58,0.1)' : 'rgba(201,75,75,0.1)', color: conn.status === 'active' ? '#4F8A5B' : conn.status === 'pending' ? '#C58A3A' : '#C94B4B' }}>
                    {conn.status === 'active' ? 'نشط' : conn.status === 'pending' ? 'معلق' : 'فشل'}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', fontFamily: 'monospace', marginBottom: '4px' }}>{conn.endpoint_url || '—'}</div>
                <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>
                  آخر اختبار: {conn.last_test_at ? formatRelativeTime(conn.last_test_at) : '—'}
                  {conn.last_test_success !== null && (
                    <span style={{ marginRight: '8px', color: conn.last_test_success ? '#4F8A5B' : '#C94B4B' }}>
                      ({conn.last_test_success ? 'ناجح' : 'فشل'})
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Heartbeats */}
      <div className="awriq-card" style={{ padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={18} color="#C89B5A" /> سجل النبضات
        </h3>
        {heartbeats.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا توجد نبضات مسجلة</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الإصدار</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الحالة</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الوقت</th>
              </tr></thead>
              <tbody>
                {heartbeats.map((hb) => (
                  <tr key={hb.id} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                    <td style={{ padding: '8px', fontSize: '13px', color: 'var(--awriq-text)' }}>{hb.system_version || '—'}</td>
                    <td style={{ padding: '8px' }}>
                      <span className="awriq-badge" style={{ background: hb.status === 'ok' ? 'rgba(79,138,91,0.1)' : hb.status === 'warning' ? 'rgba(197,138,58,0.1)' : 'rgba(201,75,75,0.1)', color: hb.status === 'ok' ? '#4F8A5B' : hb.status === 'warning' ? '#C58A3A' : '#C94B4B' }}>
                        {hb.status === 'ok' ? 'طبيعي' : hb.status === 'warning' ? 'تحذير' : 'خطأ'}
                      </span>
                    </td>
                    <td style={{ padding: '8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(hb.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="awriq-card" style={{ padding: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={18} color="#C89B5A" /> النشاط الأخير
        </h3>
        {activities.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا يوجد نشاط مسجل</div>
        ) : (
          activities.map((act) => (
            <div key={act.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--awriq-border)' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Activity size={14} color="#C89B5A" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--awriq-text)' }}>{act.details || act.action}</div>
                <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(act.created_at)}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {institution.notes && (
        <div className="awriq-card" style={{ padding: '20px', marginTop: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '12px' }}>ملاحظات</h3>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', lineHeight: 1.6, margin: 0 }}>{institution.notes}</p>
        </div>
      )}
    </div>
  )
}
