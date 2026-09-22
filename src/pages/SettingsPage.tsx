import { useState, useEffect } from 'react'
import { Settings, Save, Shield, Bell, Cable, Palette, Globe } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { SystemSetting, SettingsCategory } from '../types'

export default function SettingsPage() {
  const { showToast } = useToast()
  const [settings, setSettings] = useState<SystemSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general')
  const [editingValues, setEditingValues] = useState<Record<string, string>>({})

  useEffect(() => { loadSettings() }, [])

  const loadSettings = async () => {
    setLoading(true)
    const { data } = await supabase.from('system_settings').select('*').order('category')
    if (data) {
      setSettings(data as SystemSetting[])
      const vals: Record<string, string> = {}
      for (const s of data as SystemSetting[]) vals[s.key] = s.value || ''
      setEditingValues(vals)
    }
    setLoading(false)
  }

  const handleSave = async () => {
    const current = settings.filter(s => s.category === activeCategory)
    for (const s of current) {
      const newVal = editingValues[s.key]
      if (newVal !== s.value) {
        await supabase.from('system_settings').update({ value: newVal }).eq('id', s.id)
      }
    }
    showToast('تم حفظ الإعدادات بنجاح', 'success')
    loadSettings()
  }

  const categories: { key: SettingsCategory; label: string; icon: typeof Settings }[] = [
    { key: 'general', label: 'عام', icon: Settings },
    { key: 'security', label: 'الأمان', icon: Shield },
    { key: 'notifications', label: 'الإشعارات', icon: Bell },
    { key: 'connection', label: 'الربط', icon: Cable },
    { key: 'appearance', label: 'المظهر', icon: Palette },
    { key: 'localization', label: 'اللغة', icon: Globe },
  ]

  const filtered = settings.filter(s => s.category === activeCategory)

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}><div style={{ fontSize: '14px', color: 'var(--awriq-secondary)' }}>جاري التحميل...</div></div>
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>الإعدادات</h1>
        <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>إدارة إعدادات النظام المركزي</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '20px' }} className="settings-layout">
        {/* Category sidebar */}
        <div className="awriq-card" style={{ padding: '8px' }}>
          {categories.map(cat => {
            const I = cat.icon
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                  padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                  border: 'none', cursor: 'pointer', fontFamily: 'Cairo, sans-serif',
                  background: activeCategory === cat.key ? 'rgba(200,155,90,0.1)' : 'transparent',
                  color: activeCategory === cat.key ? '#C89B5A' : 'var(--awriq-text)',
                  marginBottom: '4px', transition: 'all 0.2s',
                }}
              >
                <I size={18} />
                {cat.label}
              </button>
            )
          })}
        </div>

        {/* Settings form */}
        <div className="awriq-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0 }}>
              {categories.find(c => c.key === activeCategory)?.label}
            </h3>
            <button onClick={handleSave} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Save size={16} /> حفظ
            </button>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--awriq-secondary)', fontSize: '14px' }}>
              لا توجد إعدادات في هذا القسم
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filtered.map(s => (
                <div key={s.id}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>
                    {s.description || s.key}
                  </label>
                  <input
                    type="text"
                    value={editingValues[s.key] || ''}
                    onChange={(e) => setEditingValues({ ...editingValues, [s.key]: e.target.value })}
                    className="awriq-input"
                    placeholder={s.key}
                    dir="ltr"
                  />
                  <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', marginTop: '4px', fontFamily: 'monospace' }}>{s.key}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
