import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Grid3x3, List, Search, Star, ExternalLink, ChevronLeft, ChevronRight, Building2, School, GraduationCap, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { Institution, InstitutionType } from '../types'
import { getConnectionStatusInfo, getInstitutionTypeLabel, formatNumber, formatRelativeTime } from '../lib/utils'
import AddInstitutionModal from '../components/institutions/AddInstitutionModal'

export default function InstitutionsPage() {
  const { showToast } = useToast()
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterGovernorate, setFilterGovernorate] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('newest')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(8)
  const [totalCount, setTotalCount] = useState(0)
  const [showAddModal, setShowAddModal] = useState(false)
  const [governorates, setGovernorates] = useState<string[]>([])

  const loadInstitutions = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('institutions').select('*', { count: 'exact' })

    if (search.trim()) {
      query = query.or(`name.ilike.%${search}%,name_ar.ilike.%${search}%,system_id.ilike.%${search}%,governorate.ilike.%${search}%,city.ilike.%${search}%`)
    }
    if (filterType !== 'all') query = query.eq('type', filterType)
    if (filterGovernorate !== 'all') query = query.eq('governorate', filterGovernorate)
    if (filterStatus !== 'all') query = query.eq('connection_status', filterStatus)

    if (sortBy === 'newest') query = query.order('created_at', { ascending: false })
    else if (sortBy === 'oldest') query = query.order('created_at', { ascending: true })
    else if (sortBy === 'name') query = query.order('name_ar', { ascending: true })

    query = query.range(page * pageSize, (page + 1) * pageSize - 1)

    const { data, count } = await query
    if (data) setInstitutions(data as Institution[])
    if (count !== null) setTotalCount(count)
    setLoading(false)
  }, [search, filterType, filterGovernorate, filterStatus, sortBy, page, pageSize])

  useEffect(() => {
    supabase.from('institutions').select('governorate').then(({ data }) => {
      if (data) {
        const govs = [...new Set(data.map(d => d.governorate).filter(Boolean))] as string[]
        setGovernorates(govs)
      }
    })
  }, [])

  useEffect(() => { loadInstitutions() }, [loadInstitutions])

  useEffect(() => { setPage(0) }, [search, filterType, filterGovernorate, filterStatus, sortBy])

  const toggleFavorite = async (id: string, current: boolean) => {
    await supabase.from('institutions').update({ is_favorite: !current }).eq('id', id)
    setInstitutions(prev => prev.map(i => i.id === id ? { ...i, is_favorite: !current } : i))
  }

  const handleAddSuccess = () => {
    setShowAddModal(false)
    showToast('تمت إضافة المؤسسة بنجاح', 'success')
    loadInstitutions()
  }

  const totalPages = Math.ceil(totalCount / pageSize)
  const startIdx = totalCount === 0 ? 0 : page * pageSize + 1
  const endIdx = Math.min((page + 1) * pageSize, totalCount)

  const typeIcon = (type: InstitutionType) => {
    if (type === 'school') return School
    if (type === 'institute') return Building2
    return GraduationCap
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>المدارس والمعاهد</h1>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>إدارة جميع المؤسسات التعليمية المسجلة</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} />
          إضافة مدرسة / معهد
        </button>
      </div>

      {/* Toolbar */}
      <div className="awriq-card" style={{ padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ flex: '1', minWidth: '250px', position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--awriq-secondary)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث في المؤسسات ..."
              className="awriq-input"
              style={{ padding: '9px 14px 9px 40px', fontSize: '13px' }}
            />
          </div>

          {/* Filters */}
          <select value={filterGovernorate} onChange={(e) => setFilterGovernorate(e.target.value)} className="awriq-input" style={{ width: 'auto', padding: '9px 14px', fontSize: '13px', cursor: 'pointer' }}>
            <option value="all">كل المحافظات</option>
            {governorates.map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="awriq-input" style={{ width: 'auto', padding: '9px 14px', fontSize: '13px', cursor: 'pointer' }}>
            <option value="all">كل الأنواع</option>
            <option value="school">مدرسة</option>
            <option value="institute">معهد</option>
            <option value="education_center">مركز تعليمي</option>
          </select>

          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="awriq-input" style={{ width: 'auto', padding: '9px 14px', fontSize: '13px', cursor: 'pointer' }}>
            <option value="all">كل الحالات</option>
            <option value="connected">متصل</option>
            <option value="delayed">متأخر</option>
            <option value="offline">غير متصل</option>
          </select>

          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="awriq-input" style={{ width: 'auto', padding: '9px 14px', fontSize: '13px', cursor: 'pointer' }}>
            <option value="newest">الأحدث أولاً</option>
            <option value="oldest">الأقدم أولاً</option>
            <option value="name">الاسم</option>
          </select>

          {/* View toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--awriq-border)', borderRadius: '8px', overflow: 'hidden' }}>
            <button
              onClick={() => setViewMode('grid')}
              style={{
                background: viewMode === 'grid' ? 'var(--color-primary)' : 'var(--awriq-surface)',
                border: 'none', padding: '8px 10px', cursor: 'pointer',
                color: viewMode === 'grid' ? 'white' : 'var(--awriq-secondary)',
                display: 'flex', alignItems: 'center', transition: 'all 0.2s',
              }}
            >
              <Grid3x3 size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{
                background: viewMode === 'list' ? 'var(--color-primary)' : 'var(--awriq-surface)',
                border: 'none', padding: '8px 10px', cursor: 'pointer',
                color: viewMode === 'list' ? 'white' : 'var(--awriq-secondary)',
                display: 'flex', alignItems: 'center', transition: 'all 0.2s',
              }}
            >
              <List size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
          <div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري تحميل المؤسسات...</div>
        </div>
      ) : institutions.length === 0 ? (
        <div className="awriq-card" style={{ padding: '48px', textAlign: 'center' }}>
          <Building2 size={48} color="var(--awriq-border)" style={{ margin: '0 auto 16px' }} />
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '8px' }}>لا توجد مؤسسات</h3>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', marginBottom: '20px' }}>لم يتم العثور على مؤسسات مطابقة للبحث</p>
          <button onClick={() => setShowAddModal(true)} className="awriq-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> إضافة مؤسسة جديدة
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }} className="inst-grid">
          {institutions.map((inst) => {
            const Icon = typeIcon(inst.type)
            const statusInfo = getConnectionStatusInfo(inst.connection_status)
            return (
              <div key={inst.id} className="awriq-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Card header with image */}
                <div style={{
                  height: '120px',
                  background: 'linear-gradient(135deg, #1A222B 0%, #242E39 100%)',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {inst.logo_url ? (
                    <img src={inst.logo_url} alt={inst.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Icon size={40} color="#C89B5A" strokeWidth={1.5} />
                  )}
                  {/* Favorite */}
                  <button
                    onClick={() => toggleFavorite(inst.id, inst.is_favorite)}
                    style={{
                      position: 'absolute', top: '8px', left: '8px',
                      background: 'rgba(0,0,0,0.4)', border: 'none',
                      borderRadius: '50%', width: '32px', height: '32px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Star size={16} fill={inst.is_favorite ? '#C89B5A' : 'none'} color={inst.is_favorite ? '#C89B5A' : '#8A95A0'} />
                  </button>
                  {/* Status badge */}
                  <div style={{
                    position: 'absolute', top: '8px', right: '8px',
                    background: 'rgba(0,0,0,0.5)', borderRadius: '20px',
                    padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '5px',
                  }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: statusInfo.dotColor }} />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'white' }}>{statusInfo.label}</span>
                  </div>
                </div>

                {/* Card body */}
                <div style={{ padding: '14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--awriq-text)', margin: '0 0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {inst.name_ar || inst.name}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <span className="awriq-badge" style={{ background: 'rgba(138,90,43,0.1)', color: '#8A5A2B' }}>
                      {getInstitutionTypeLabel(inst.type)}
                    </span>
                    {inst.governorate && (
                      <span style={{ fontSize: '11px', color: 'var(--awriq-secondary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <MapPin size={11} /> {inst.governorate}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', fontSize: '12px' }}>
                    <div>
                      <span style={{ color: 'var(--awriq-secondary)' }}>الطلاب: </span>
                      <span style={{ fontWeight: 600, color: 'var(--awriq-text)' }}>{formatNumber(inst.student_count)}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--awriq-secondary)' }}>المعلمون: </span>
                      <span style={{ fontWeight: 600, color: 'var(--awriq-text)' }}>{formatNumber(inst.teacher_count)}</span>
                    </div>
                  </div>

                  <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>الإصدار: {inst.system_version || '—'}</span>
                    <span>{formatRelativeTime(inst.last_heartbeat_at)}</span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
                    <Link to={`/institutions/${inst.id}`} style={{ flex: 1 }}>
                      <button className="awriq-btn-secondary" style={{ width: '100%', padding: '7px', fontSize: '12px' }}>التفاصيل</button>
                    </Link>
                    {inst.domain && (
                      <a href={inst.domain} target="_blank" rel="noopener noreferrer" style={{ display: 'flex' }}>
                        <button className="awriq-btn-primary" style={{ padding: '7px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <ExternalLink size={13} /> فتح
                        </button>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* List view */
        <div className="awriq-card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--awriq-border)', background: 'var(--awriq-bg)' }}>
                  <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>المؤسسة</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>النوع</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الموقع</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>System ID</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الطلاب</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>المعلمون</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الإصدار</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الحالة</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>آخر اتصال</th>
                  <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {institutions.map((inst) => {
                  const statusInfo = getConnectionStatusInfo(inst.connection_status)
                  const Icon = typeIcon(inst.type)
                  return (
                    <tr key={inst.id} style={{ borderBottom: '1px solid var(--awriq-border)', transition: 'background 0.2s' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--awriq-bg)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '12px 16px' }}>
                        <Link to={`/institutions/${inst.id}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
                          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'linear-gradient(135deg, #1A222B 0%, #242E39 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Icon size={18} color="#C89B5A" />
                          </div>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{inst.name_ar || inst.name}</span>
                        </Link>
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--awriq-secondary)' }}>{getInstitutionTypeLabel(inst.type)}</td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--awriq-secondary)' }}>{inst.governorate || '—'}</td>
                      <td style={{ padding: '12px 8px', fontSize: '11px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>{inst.system_id}</td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{formatNumber(inst.student_count)}</td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{formatNumber(inst.teacher_count)}</td>
                      <td style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{inst.system_version || '—'}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <span className="awriq-badge" style={{ background: `${statusInfo.color}15`, color: statusInfo.color }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusInfo.dotColor }} />
                          {statusInfo.label}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(inst.last_heartbeat_at)}</td>
                      <td style={{ padding: '12px 8px', display: 'flex', gap: '4px', justifyContent: 'center' }}>
                        <Link to={`/institutions/${inst.id}`}>
                          <button style={{ background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', fontSize: '11px', color: 'var(--awriq-text)', fontFamily: 'Cairo, sans-serif' }}>تفاصيل</button>
                        </Link>
                        {inst.domain && (
                          <a href={inst.domain} target="_blank" rel="noopener noreferrer">
                            <button style={{ background: 'var(--color-primary)', border: 'none', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', fontSize: '11px', color: 'white', fontFamily: 'Cairo, sans-serif' }}>فتح</button>
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ fontSize: '13px', color: 'var(--awriq-secondary)' }}>
            عرض {startIdx} - {endIdx} من {totalCount} مؤسسة
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="awriq-input" style={{ width: 'auto', padding: '6px 10px', fontSize: '12px' }}>
              <option value={8}>8</option>
              <option value={12}>12</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              style={{ background: 'var(--awriq-surface)', border: '1px solid var(--awriq-border)', borderRadius: '8px', padding: '6px 10px', cursor: page === 0 ? 'not-allowed' : 'pointer', color: page === 0 ? 'var(--awriq-border)' : 'var(--awriq-text)', opacity: page === 0 ? 0.5 : 1 }}
            >
              <ChevronRight size={16} />
            </button>
            <span style={{ fontSize: '13px', color: 'var(--awriq-text)', fontWeight: 600 }}>
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              style={{ background: 'var(--awriq-surface)', border: '1px solid var(--awriq-border)', borderRadius: '8px', padding: '6px 10px', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', color: page >= totalPages - 1 ? 'var(--awriq-border)' : 'var(--awriq-text)', opacity: page >= totalPages - 1 ? 0.5 : 1 }}
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>
      )}

      {showAddModal && <AddInstitutionModal onClose={() => setShowAddModal(false)} onSuccess={handleAddSuccess} />}
    </div>
  )
}
