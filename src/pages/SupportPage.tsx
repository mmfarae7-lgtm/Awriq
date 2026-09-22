import { useState, useEffect } from 'react'
import { LifeBuoy, Plus, X, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import type { SupportTicket, Institution, TicketPriority, TicketStatus } from '../types'
import { formatRelativeTime, generateTicketNumber } from '../lib/utils'

export default function SupportPage() {
  const { showToast } = useToast()
  const { session } = useAuth()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ institution_id: '', subject: '', description: '', priority: 'medium' as TicketPriority })

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    const { data: tkts } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false })
    if (tkts) setTickets(tkts as SupportTicket[])
    const { data: insts } = await supabase.from('institutions').select('id, name, name_ar')
    if (insts) setInstitutions(insts as Institution[])
    setLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.subject.trim()) { showToast('يرجى إدخال الموضوع', 'warning'); return }
    if (!session?.user?.id) { showToast('يرجى تسجيل الدخول', 'error'); return }

    const { error } = await supabase.from('support_tickets').insert({
      ticket_number: generateTicketNumber(),
      institution_id: form.institution_id || null,
      created_by: session.user.id,
      subject: form.subject,
      description: form.description || null,
      priority: form.priority,
      status: 'open',
    })

    if (error) {
      showToast('فشل إنشاء التذكرة: ' + error.message, 'error')
      return
    }

    await supabase.from('activity_logs').insert({
      action: 'support_ticket_created',
      resource: 'support_ticket',
      details: `تم إنشاء تذكرة دعم: ${form.subject}`,
    })

    showToast('تم إنشاء التذكرة بنجاح', 'success')
    setShowModal(false)
    setForm({ institution_id: '', subject: '', description: '', priority: 'medium' })
    loadData()
  }

  const updateStatus = async (id: string, status: TicketStatus) => {
    await supabase.from('support_tickets').update({ status, resolved_at: status === 'resolved' || status === 'closed' ? new Date().toISOString() : null }).eq('id', id)
    setTickets(prev => prev.map(t => t.id === id ? { ...t, status } : t))
    showToast('تم تحديث حالة التذكرة', 'success')
  }

  const priorityColors: Record<string, string> = { low: '#68727A', medium: '#C58A3A', high: '#C94B4B', critical: '#C94B4B' }
  const priorityLabels: Record<string, string> = { low: 'منخفض', medium: 'متوسط', high: 'عالي', critical: 'حرج' }
  const statusColors: Record<string, string> = { open: '#C58A3A', in_progress: '#8A5A2B', resolved: '#4F8A5B', closed: '#68727A' }
  const statusLabels: Record<string, string> = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلقة' }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>الدعم الفني</h1>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>إنشاء وإدارة تذاكر الدعم الفني</p>
        </div>
        <button onClick={() => setShowModal(true)} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> تذكرة جديدة
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }} className="stats-grid">
        {[
          { label: 'إجمالي التذاكر', value: tickets.length, color: '#8A5A2B' },
          { label: 'مفتوحة', value: tickets.filter(t => t.status === 'open').length, color: '#C58A3A' },
          { label: 'قيد المعالجة', value: tickets.filter(t => t.status === 'in_progress').length, color: '#8A5A2B' },
          { label: 'تم الحل', value: tickets.filter(t => t.status === 'resolved').length, color: '#4F8A5B' },
        ].map((s, i) => (
          <div key={i} className="awriq-card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', marginTop: '4px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tickets list */}
      <div className="awriq-card" style={{ overflow: 'hidden' }}>
        {tickets.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <LifeBuoy size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', marginBottom: '16px' }}>لا توجد تذاكر دعم</p>
            <button onClick={() => setShowModal(true)} className="awriq-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={18} /> إنشاء تذكرة
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--awriq-border)', background: 'var(--awriq-bg)' }}>
                  <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>رقم التذكرة</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الموضوع</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الأولوية</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الحالة</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>الوقت</th>
                  <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--awriq-secondary)' }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--awriq-border)' }}>
                    <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--awriq-secondary)', fontFamily: 'monospace' }}>{t.ticket_number}</td>
                    <td style={{ padding: '12px 8px', fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{t.subject}</td>
                    <td style={{ padding: '12px 8px' }}>
                      <span className="awriq-badge" style={{ background: `${priorityColors[t.priority]}15`, color: priorityColors[t.priority] }}>{priorityLabels[t.priority]}</span>
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <span className="awriq-badge" style={{ background: `${statusColors[t.status]}15`, color: statusColors[t.status] }}>{statusLabels[t.status]}</span>
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--awriq-secondary)' }}>{formatRelativeTime(t.created_at)}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                      {t.status === 'open' && (
                        <button onClick={() => updateStatus(t.id, 'in_progress')} style={{ background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: 'var(--awriq-text)', fontFamily: 'Cairo, sans-serif' }}>بدء المعالجة</button>
                      )}
                      {t.status === 'in_progress' && (
                        <button onClick={() => updateStatus(t.id, 'resolved')} style={{ background: 'none', border: '1px solid var(--awriq-border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: '#4F8A5B', fontFamily: 'Cairo, sans-serif' }}>حل</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--awriq-surface)', borderRadius: '16px', width: '100%', maxWidth: '500px', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--awriq-border)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0 }}>تذكرة دعم جديدة</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--awriq-secondary)' }}><X size={22} /></button>
            </div>
            <form onSubmit={handleSubmit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>المؤسسة</label>
                <select value={form.institution_id} onChange={(e) => setForm({ ...form, institution_id: e.target.value })} className="awriq-input" style={{ cursor: 'pointer' }}>
                  <option value="">بدون مؤسسة محددة</option>
                  {institutions.map(i => <option key={i.id} value={i.id}>{i.name_ar || i.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>الموضوع *</label>
                <input type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="awriq-input" placeholder="موضوع التذكرة" />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>الوصف</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="awriq-input" rows={4} placeholder="اشرح المشكلة بالتفصيل" style={{ resize: 'vertical' }} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>الأولوية</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TicketPriority })} className="awriq-input" style={{ cursor: 'pointer' }}>
                  <option value="low">منخفض</option>
                  <option value="medium">متوسط</option>
                  <option value="high">عالي</option>
                  <option value="critical">حرج</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowModal(false)} className="awriq-btn-secondary">إلغاء</button>
                <button type="submit" className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Send size={16} /> إرسال</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
