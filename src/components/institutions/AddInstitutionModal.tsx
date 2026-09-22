import { useState } from 'react'
import { X, Building2, Save } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import type { InstitutionType } from '../../types'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function AddInstitutionModal({ onClose, onSuccess }: Props) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    name_ar: '',
    type: 'school' as InstitutionType,
    system_name: '',
    domain: '',
    governorate: '',
    city: '',
    address: '',
    contact_email: '',
    contact_phone: '',
    notes: '',
    admin_name: '',
    admin_email: '',
    admin_phone: '',
    student_count: 0,
    teacher_count: 0,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.name.trim()) { showToast('يرجى إدخال اسم المؤسسة', 'warning'); return }
    if (!form.system_name.trim()) { showToast('يرجى إدخال اسم النظام', 'warning'); return }

    setSaving(true)

    const typePrefix = form.type === 'school' ? 'SCH' : form.type === 'institute' ? 'INS' : 'EDU'
    const { count } = await supabase.from('institutions').select('*', { count: 'exact', head: true })
    const seqNum = (count || 0) + 1
    const systemId = `${typePrefix}-${String(seqNum).padStart(6, '0')}`

    const { data: inst, error } = await supabase.from('institutions').insert({
      name: form.name,
      name_ar: form.name_ar || null,
      type: form.type,
      system_name: form.system_name,
      domain: form.domain || null,
      governorate: form.governorate || null,
      city: form.city || null,
      address: form.address || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      notes: form.notes || null,
      system_id: systemId,
      status: 'active',
      connection_status: 'offline',
      student_count: form.student_count,
      teacher_count: form.teacher_count,
    }).select('*').single()

    if (error) {
      showToast('فشل إضافة المؤسسة: ' + error.message, 'error')
      setSaving(false)
      return
    }

    if (form.admin_name && inst) {
      await supabase.from('institution_admins').insert({
        institution_id: inst.id,
        name: form.admin_name,
        email: form.admin_email || null,
        phone: form.admin_phone || null,
        role: 'admin',
        is_primary: true,
      })
    }

    if (inst) {
      await supabase.from('system_connections').insert({
        institution_id: inst.id,
        connection_type: 'api',
        endpoint_url: form.domain || null,
        status: 'pending',
      })

      await supabase.from('activity_logs').insert({
        action: 'institution_registered',
        resource: 'institution',
        resource_id: systemId,
        institution_id: inst.id,
        details: `تم تسجيل مؤسسة جديدة: ${form.name_ar || form.name}`,
      })

      await supabase.from('notifications').insert({
        type: 'success',
        title: 'New Institution Registered',
        title_ar: 'مؤسسة جديدة مسجلة',
        message: `${form.name} has been registered`,
        message_ar: `تم تسجيل ${form.name_ar || form.name} في النظام`,
        is_read: false,
        institution_id: inst.id,
      })
    }

    setSaving(false)
    onSuccess()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: 'var(--awriq-surface)', borderRadius: '16px', width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto', animation: 'fadeIn 0.2s ease-out' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--awriq-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(138,90,43,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Building2 size={20} color="#8A5A2B" />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0 }}>إضافة مؤسسة جديدة</h2>
              <p style={{ fontSize: '13px', color: 'var(--awriq-secondary)', margin: 0 }}>أدخل بيانات المؤسسة لتسجيلها في النظام</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--awriq-secondary)', padding: '4px' }}>
            <X size={22} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="form-grid">
            <Field label="اسم المؤسسة (إنجليزي)" required>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="awriq-input" placeholder="Institution Name" dir="ltr" />
            </Field>
            <Field label="اسم المؤسسة (عربي)">
              <input type="text" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="awriq-input" placeholder="اسم المؤسسة" />
            </Field>
            <Field label="نوع المؤسسة" required>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as InstitutionType })} className="awriq-input" style={{ cursor: 'pointer' }}>
                <option value="school">مدرسة</option>
                <option value="institute">معهد</option>
                <option value="education_center">مركز تعليمي</option>
              </select>
            </Field>
            <Field label="اسم النظام">
              <input type="text" value={form.system_name} onChange={(e) => setForm({ ...form, system_name: e.target.value })} className="awriq-input" placeholder="System Name" dir="ltr" />
            </Field>
            <Field label="الموقع (Domain)">
              <input type="text" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} className="awriq-input" placeholder="https://example.com" dir="ltr" />
            </Field>
            <Field label="المحافظة">
              <input type="text" value={form.governorate} onChange={(e) => setForm({ ...form, governorate: e.target.value })} className="awriq-input" placeholder="المحافظة" />
            </Field>
            <Field label="المدينة">
              <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="awriq-input" placeholder="المدينة" />
            </Field>
            <Field label="العنوان">
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="awriq-input" placeholder="العنوان التفصيلي" />
            </Field>
            <Field label="البريد الإلكتروني">
              <input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="awriq-input" placeholder="info@example.com" dir="ltr" />
            </Field>
            <Field label="الهاتف">
              <input type="text" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="awriq-input" placeholder="+967-xxx-xxx" dir="ltr" />
            </Field>
            <Field label="عدد الطلاب">
              <input type="number" value={form.student_count} onChange={(e) => setForm({ ...form, student_count: Number(e.target.value) })} className="awriq-input" placeholder="0" dir="ltr" />
            </Field>
            <Field label="عدد المعلمين">
              <input type="number" value={form.teacher_count} onChange={(e) => setForm({ ...form, teacher_count: Number(e.target.value) })} className="awriq-input" placeholder="0" dir="ltr" />
            </Field>
          </div>

          {/* Admin section */}
          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--awriq-border)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '12px' }}>معلومات مسؤول المؤسسة</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }} className="form-grid">
              <Field label="اسم المسؤول">
                <input type="text" value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} className="awriq-input" placeholder="اسم المسؤول" />
              </Field>
              <Field label="بريد المسؤول">
                <input type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} className="awriq-input" placeholder="admin@example.com" dir="ltr" />
              </Field>
              <Field label="هاتف المسؤول">
                <input type="text" value={form.admin_phone} onChange={(e) => setForm({ ...form, admin_phone: e.target.value })} className="awriq-input" placeholder="+967-xxx" dir="ltr" />
              </Field>
            </div>
          </div>

          <Field label="ملاحظات" style={{ marginTop: '16px' }}>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="awriq-input" rows={3} placeholder="ملاحظات إضافية" style={{ resize: 'vertical' }} />
          </Field>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
            <button type="button" onClick={onClose} className="awriq-btn-secondary">إلغاء</button>
            <button type="submit" disabled={saving} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: saving ? 0.6 : 1 }}>
              <Save size={18} />
              {saving ? 'جاري الحفظ...' : 'حفظ المؤسسة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, required, children, style }: { label: string; required?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>
        {label} {required && <span style={{ color: '#C94B4B' }}>*</span>}
      </label>
      {children}
    </div>
  )
}
