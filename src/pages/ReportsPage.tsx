import { useState, useEffect } from 'react'
import { Building2, School, GraduationCap, Wifi, WifiOff, Clock, TrendingUp, Server, Activity } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Institution } from '../types'
import { formatNumber, getInstitutionTypeLabel } from '../lib/utils'

export default function ReportsPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    const { data } = await supabase.from('institutions').select('*')
    if (data) setInstitutions(data as Institution[])
    setLoading(false)
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  const total = institutions.length
  const schools = institutions.filter(i => i.type === 'school').length
  const institutes = institutions.filter(i => i.type === 'institute').length
  const centers = institutions.filter(i => i.type === 'education_center').length
  const connected = institutions.filter(i => i.connection_status === 'connected').length
  const delayed = institutions.filter(i => i.connection_status === 'delayed').length
  const offline = institutions.filter(i => i.connection_status === 'offline').length
  const totalStudents = institutions.reduce((s, i) => s + i.student_count, 0)
  const versions = {} as Record<string, number>
  institutions.forEach(i => { if (i.system_version) versions[i.system_version] = (versions[i.system_version] || 0) + 1 })

  const reportCards = [
    { label: 'إجمالي المؤسسات', value: total, icon: Building2, color: '#8A5A2B' },
    { label: 'المدارس', value: schools, icon: School, color: '#C89B5A' },
    { label: 'المعاهد', value: institutes, icon: GraduationCap, color: '#68421F' },
    { label: 'مراكز تعليمية', value: centers, icon: Building2, color: '#B9854A' },
    { label: 'أنظمة متصلة', value: connected, icon: Wifi, color: '#4F8A5B' },
    { label: 'أنظمة متأخرة', value: delayed, icon: Clock, color: '#C58A3A' },
    { label: 'أنظمة غير متصلة', value: offline, icon: WifiOff, color: '#C94B4B' },
    { label: 'إجمالي الطلاب', value: formatNumber(totalStudents), icon: TrendingUp, color: '#4F8A5B' },
  ]

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>التقارير</h1>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>تقارير مركزية شاملة عن الأنظمة والمؤسسات</p>
        </div>
      </div>

      {/* Report cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }} className="stats-grid">
        {reportCards.map((card, i) => {
          const I = card.icon
          return (
            <div key={i} className="awriq-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: `${card.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I size={22} color={card.color} />
                </div>
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--awriq-text)', marginBottom: '4px' }}>{card.value}</div>
              <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)' }}>{card.label}</div>
            </div>
          )
        })}
      </div>

      {/* Two columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="two-col-grid">
        {/* Version distribution */}
        <div className="awriq-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={18} color="#C89B5A" /> توزيع إصدارات الأنظمة
          </h3>
          {Object.keys(versions).length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا توجد بيانات</div>
          ) : (
            Object.entries(versions).sort().map(([ver, count]) => {
              const pct = (count / total) * 100
              return (
                <div key={ver} style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', fontFamily: 'monospace' }}>v{ver}</span>
                    <span style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>{count} نظام</span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--awriq-bg)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #C89B5A, #8A5A2B)', borderRadius: '4px', transition: 'width 0.3s' }} />
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Connection status */}
        <div className="awriq-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} color="#C89B5A" /> حالة الاتصالات
          </h3>
          {[
            { label: 'متصل', value: connected, color: '#4F8A5B' },
            { label: 'متأخر', value: delayed, color: '#C58A3A' },
            { label: 'غير متصل', value: offline, color: '#C94B4B' },
          ].map((s, i) => {
            const pct = total > 0 ? (s.value / total) * 100 : 0
            return (
              <div key={i} style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{s.label}</span>
                  <span style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>{s.value} ({pct.toFixed(0)}%)</span>
                </div>
                <div style={{ height: '8px', background: 'var(--awriq-bg)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: s.color, borderRadius: '4px', transition: 'width 0.3s' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Institution activity table */}
      <div className="awriq-card" style={{ padding: '20px', marginTop: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '16px' }}>نشاط المؤسسات</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>المؤسسة</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>النوع</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الطلاب</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>المعلمون</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الإصدار</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {institutions.map((inst) => (
                <tr key={inst.id} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                  <td style={{ padding: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{inst.name_ar || inst.name}</td>
                  <td style={{ padding: '8px', fontSize: '13px', color: 'var(--awriq-secondary)' }}>{getInstitutionTypeLabel(inst.type)}</td>
                  <td style={{ padding: '8px', fontSize: '13px', color: 'var(--awriq-text)' }}>{formatNumber(inst.student_count)}</td>
                  <td style={{ padding: '8px', fontSize: '13px', color: 'var(--awriq-text)' }}>{formatNumber(inst.teacher_count)}</td>
                  <td style={{ padding: '8px', fontSize: '12px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>{inst.system_version || '—'}</td>
                  <td style={{ padding: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: inst.connection_status === 'connected' ? '#4F8A5B' : inst.connection_status === 'delayed' ? '#C58A3A' : '#C94B4B' }}>
                      {inst.connection_status === 'connected' ? 'متصل' : inst.connection_status === 'delayed' ? 'متأخر' : 'غير متصل'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
