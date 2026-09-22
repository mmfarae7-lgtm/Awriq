import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Building2, GraduationCap, Users, School, Feather, ArrowLeft, Activity, Wifi, WifiOff, Clock, FolderGit2, Bot } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Institution } from '../types'
import { formatNumber, getConnectionStatusInfo, getInstitutionTypeLabel, formatRelativeTime } from '../lib/utils'

export default function DashboardPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalSchools: 0,
    totalInstitutes: 0,
    totalStudents: 0,
    totalTeachers: 0,
    connected: 0,
    delayed: 0,
    offline: 0,
  total: 0,
  active: 0,
  disabled: 0,
  latestHeartbeats: [] as { name: string; name_ar: string | null; system_id: string; connection_status: string; last_heartbeat_at: string | null }[],
  recentActivity: [] as { id: string; action: string; details: string | null; created_at: string }[],
  recentNotifications: [] as { id: string; title: string; title_ar: string | null; type: string; is_read: boolean; created_at: string }[],
    totalSystems: 0,
    openAgentTasks: 0,
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    const { data: instData } = await supabase
      .from('institutions')
      .select('*')
      .order('created_at', { ascending: false })

    if (instData) {
      setInstitutions(instData as Institution[])
      const total = instData.length
      const schools = instData.filter(i => i.type === 'school').length
      const institutes = instData.filter(i => i.type === 'institute').length
      const students = instData.reduce((sum, i) => sum + (i.student_count || 0), 0)
      const teachers = instData.reduce((sum, i) => sum + (i.teacher_count || 0), 0)
      const connected = instData.filter(i => i.connection_status === 'connected').length
      const delayed = instData.filter(i => i.connection_status === 'delayed').length
      const offline = instData.filter(i => i.connection_status === 'offline').length
      const active = instData.filter(i => i.status === 'active').length
      const disabled = instData.filter(i => i.status === 'disabled').length

      setStats(prev => ({
        ...prev,
        totalSchools: schools,
        totalInstitutes: institutes,
        totalStudents: students,
        totalTeachers: teachers,
        connected,
        delayed,
        offline,
        total,
        active,
        disabled,
        latestHeartbeats: instData.slice(0, 5).map(i => ({
          name: i.name,
          name_ar: i.name_ar,
          system_id: i.system_id,
          connection_status: i.connection_status,
          last_heartbeat_at: i.last_heartbeat_at,
        })),
      }))
    }

    const { data: activityData } = await supabase
      .from('activity_logs')
      .select('id, action, details, created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    if (activityData) {
      setStats(prev => ({ ...prev, recentActivity: activityData as typeof prev.recentActivity }))
    }

    const { data: notifData } = await supabase
      .from('notifications')
      .select('id, title, title_ar, type, is_read, created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    if (notifData) {
      setStats(prev => ({ ...prev, recentNotifications: notifData as typeof prev.recentNotifications }))
    }

    const { count: projectCount } = await supabase.from('projects').select('*', { count: 'exact', head: true }).eq('is_active', true)
    const { count: taskCount } = await supabase.from('agent_tasks').select('*', { count: 'exact', head: true }).in('status', ['pending', 'analyzing', 'running', 'waiting_approval'])
    setStats(prev => ({ ...prev, totalSystems: projectCount || 0, openAgentTasks: taskCount || 0 }))

    setLoading(false)
  }

  const statCards = [
    { label: 'إجمالي المدارس', value: stats.totalSchools, icon: School, color: '#8A5A2B' },
    { label: 'إجمالي المعاهد', value: stats.totalInstitutes, icon: Building2, color: '#C89B5A' },
    { label: 'إجمالي الطلاب', value: formatNumber(stats.totalStudents), icon: GraduationCap, color: '#4F8A5B' },
    { label: 'إجمالي المعلمين', value: formatNumber(stats.totalTeachers), icon: Users, color: '#68421F' },
    { label: 'الأنظمة المرتبطة', value: stats.totalSystems, icon: FolderGit2, color: '#8A5A2B' },
    { label: 'مهام برمجية مفتوحة', value: stats.openAgentTasks, icon: Bot, color: '#C58A3A' },
  ]

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
        <div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري تحميل البيانات...</div>
      </div>
    )
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Welcome section */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <Feather size={28} color="#C89B5A" strokeWidth={2} />
          <h1 style={{ fontSize: '28px', fontWeight: 800, color: 'var(--awriq-text)', margin: 0 }}>
            مرحبًا بك في نظام أوراق
          </h1>
        </div>
        <p style={{ fontSize: '15px', color: 'var(--awriq-secondary)', margin: 0, paddingRight: '40px' }}>
          النظام الشامل لإدارة المعاهد والمدارس
        </p>
      </div>

      {/* Statistics cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
      }} className="stats-grid">
        {statCards.map((card, i) => {
          const Icon = card.icon
          return (
            <div key={i} className="awriq-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '10px',
                  background: `${card.color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Icon size={22} color={card.color} />
                </div>
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--awriq-text)', marginBottom: '4px' }}>
                {card.value}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)', fontWeight: 500 }}>
                {card.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Connection status overview */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '16px',
        marginBottom: '32px',
      }} className="connection-grid">
        {[
          { label: 'أنظمة متصلة', value: stats.connected, icon: Wifi, color: '#4F8A5B', bg: 'rgba(79,138,91,0.1)' },
          { label: 'أنظمة متأخرة', value: stats.delayed, icon: Clock, color: '#C58A3A', bg: 'rgba(197,138,58,0.1)' },
          { label: 'أنظمة غير متصلة', value: stats.offline, icon: WifiOff, color: '#C94B4B', bg: 'rgba(201,75,75,0.1)' },
        ].map((item, i) => {
          const Icon = item.icon
          return (
            <div key={i} className="awriq-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: item.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon size={20} color={item.color} />
              </div>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--awriq-text)' }}>{item.value}</div>
                <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>{item.label}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Two columns: Latest heartbeats + Recent activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }} className="two-col-grid">
        {/* Latest heartbeats */}
        <div className="awriq-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={18} color="#C89B5A" />
              أحدث الأنباض
            </h3>
            <Link to="/connections" style={{ fontSize: '12px', color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              عرض الكل
              <ArrowLeft size={14} />
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {stats.latestHeartbeats.map((item, i) => {
              const statusInfo = getConnectionStatusInfo(item.connection_status as 'connected' | 'delayed' | 'offline')
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < stats.latestHeartbeats.length - 1 ? '1px solid var(--awriq-border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusInfo.dotColor, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{item.name_ar || item.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>{item.system_id}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: statusInfo.color }}>{statusInfo.label}</div>
                    <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(item.last_heartbeat_at)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Recent activity */}
        <div className="awriq-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} color="#C89B5A" />
              أحدث النشاطات
            </h3>
            <Link to="/activity" style={{ fontSize: '12px', color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              عرض الكل
              <ArrowLeft size={14} />
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {stats.recentActivity.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--awriq-secondary)', fontSize: '13px' }}>لا يوجد نشاط</div>
            ) : (
              stats.recentActivity.map((item, i) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: i < stats.recentActivity.length - 1 ? '1px solid var(--awriq-border)' : 'none' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Activity size={16} color="#C89B5A" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--awriq-text)' }}>{item.details || item.action}</div>
                    <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(item.created_at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick institutions preview */}
      <div className="awriq-card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0 }}>
            المؤسسات المسجلة
          </h3>
          <Link to="/institutions" style={{ fontSize: '12px', color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
            عرض الكل
            <ArrowLeft size={14} />
          </Link>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>المؤسسة</th>
                <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>النوع</th>
                <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>System ID</th>
                <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الحالة</th>
                <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الطلاب</th>
                <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>آخر اتصال</th>
              </tr>
            </thead>
            <tbody>
              {institutions.slice(0, 6).map((inst) => {
                const statusInfo = getConnectionStatusInfo(inst.connection_status)
                return (
                  <tr key={inst.id} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                    <td style={{ padding: '10px 8px', fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>
                      <Link to={`/institutions/${inst.id}`} style={{ color: 'var(--awriq-text)', textDecoration: 'none' }}>
                        {inst.name_ar || inst.name}
                      </Link>
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: '13px', color: 'var(--awriq-secondary)' }}>{getInstitutionTypeLabel(inst.type)}</td>
                    <td style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>{inst.system_id}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span className="awriq-badge" style={{ background: `${statusInfo.color}15`, color: statusInfo.color }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusInfo.dotColor }} />
                        {statusInfo.label}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: '13px', color: 'var(--awriq-text)' }}>{formatNumber(inst.student_count)}</td>
                    <td style={{ padding: '10px 8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(inst.last_heartbeat_at)}</td>
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
