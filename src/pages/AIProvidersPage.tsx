import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Cpu, Power, Star, Loader2, Link2, Trash2, KeyRound } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import type { AIProvider, AIModel } from '../lib/ai'

interface ProviderRow extends AIProvider {
  models?: AIModel[]
}

interface ModelMeta {
  id: string
  object?: string
  owned_by?: string
}

export default function AIProvidersPage() {
  const { showToast } = useToast()
  const { roles } = useAuth()
  const isAdmin = roles.some(r => r.name === 'super_admin')

  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [probeLoading, setProbeLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', code: '', base_url: '', auth_method: 'bearer',
    api_key: '', is_free: true, priority: 20,
  })

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [p, m] = await Promise.all([
      supabase.from('ai_providers').select('*').order('priority', { ascending: true }),
      supabase.from('ai_models').select('*'),
    ])
    if (p.data && m.data) {
      const rows = (p.data as AIProvider[]).map(prov => ({
        ...prov,
        models: (m.data as AIModel[]).filter(md => md.provider_id === prov.id),
      }))
      setProviders(rows)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  if (!isAdmin) {
    return (
      <div className="awriq-card" style={{ padding: '48px', textAlign: 'center', color: 'var(--awriq-secondary)', fontSize: '14px' }}>
        <LockIcon /> هذه الصفحة متاحة للمدير العام فقط.
      </div>
    )
  }

  function LockIcon() {
    return <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔒</div>
  }

  const probeModels = async (): Promise<string[]> => {
    const base = form.base_url.replace(/\/+$/, '')
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'AWRIQ-Agent/1.0' }
    if (form.auth_method !== 'none' && form.api_key) headers.authorization = `Bearer ${form.api_key.trim()}`
    const res = await fetch(`${base}/models`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status} — تعذر استكشاف النماذج من ${base}/models`)
    const data = await res.json()
    const list = (data.data ?? []) as ModelMeta[]
    if (list.length === 0) throw new Error('لا توجد نماذج في الاستجابة')
    return list.map(l => l.id)
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.base_url.trim()) { showToast('أدخل الاسم والرابط', 'warning'); return }
    const code = form.code.trim() || form.name.trim().toLowerCase().replace(/[^a-z0-9]+/gi, '-')

    setProbeLoading(true)
    let modelIds: string[] = []
    try {
      modelIds = await probeModels()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(msg, 'error')
      setProbeLoading(false)
      return
    }

    const { data, error } = await supabase.from('ai_providers').insert({
      code,
      name: form.name.trim(),
      base_url: form.base_url.trim().replace(/\/+$/, ''),
      auth_method: form.auth_method,
      is_free: form.is_free,
      priority: form.priority,
      config: form.api_key.trim() ? { api_key: form.api_key.trim(), openai_compatible: true } : { openai_compatible: true },
    }).select('*').single()

    if (error) {
      showToast('فشل إضافة المزوّد: ' + error.message, 'error')
      setProbeLoading(false)
      return
    }

    const prov = data as AIProvider
    const modelRows = modelIds.map((mid, idx) => ({
      provider_id: prov.id,
      model_id: mid,
      name: mid,
      context_window: null,
      supports_tools: false,
      is_default: idx === 0,
      is_enabled: true,
      cost_input_usd: 0,
      cost_output_usd: 0,
    }))
    const { error: mErr } = await supabase.from('ai_models').insert(modelRows)
    if (mErr) showToast('أضيف المزوّد لكن فشل إضافة النماذج: ' + mErr.message, 'warning')

    showToast(`تم ربط المزوّد مع ${modelIds.length} نموذج`, 'success')
    setShowAdd(false)
    setForm({ name: '', code: '', base_url: '', auth_method: 'bearer', api_key: '', is_free: true, priority: 20 })
    await loadAll()
    setProbeLoading(false)
  }

  const toggleProvider = async (p: ProviderRow) => {
    const { error } = await supabase.from('ai_providers').update({ is_enabled: !p.is_enabled }).eq('id', p.id)
    if (error) { showToast(error.message, 'error'); return }
    showToast(p.is_enabled ? 'تم تعطيل المزوّد' : 'تم تفعيل المزوّد', 'success')
    await loadAll()
  }

  const removeProvider = async (p: ProviderRow) => {
    const { error } = await supabase.from('ai_providers').delete().eq('id', p.id)
    if (error) { showToast(error.message, 'error'); return }
    showToast('تم حذف المزوّد', 'success')
    await loadAll()
  }

  const setDefaultModel = async (p: ProviderRow, mid: string) => {
    const { error } = await supabase.from('ai_models').update({ is_default: false }).eq('provider_id', p.id)
    if (error) { showToast(error.message, 'error'); return }
    const { error: e2 } = await supabase.from('ai_models').update({ is_default: true }).eq('id', mid)
    if (e2) { showToast(e2.message, 'error'); return }
    showToast('تم تعيين النموذج الافتراضي', 'success')
    await loadAll()
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--awriq-text)', margin: '0 0 4px' }}>مزوّدات الذكاء الاصطناعي</h1>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', margin: 0 }}>
            اربط أي مزوّد متوافق مع OpenAI (Groq, OpenRouter, OpenCode Zen, local...). تلقائياً يُستكشف ويُجرّب في غرفة الوكيل.
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> ربط مزوّد جديد
        </button>
      </div>

      <div className="awriq-card" style={{ padding: '16px', marginBottom: '16px', display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '12px', color: '#C58A3A', lineHeight: 1.6 }}>
        <KeyRound size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          المزوّدات الموسومة «السرّ في الخادم» (OpenRouter, Gemini…) تُخزّن مفتاحها مشفّرًا في AWRIQ ويُحقن عبر دالة <code>ai-proxy</code> — لا يصل المفتاح للمتصفح أبدًا. الربط اليدوي عبر النموذج أدناه (BYOK) يخزّن المفتاح في <code>config.api_key</code> ويصل للواجهة؛ يُفضَّل لمن يتطلب انكشافًا أقل استخدام مفتاح عام/مجاني أو النمط المدار من الخادم.
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
          <Loader2 size={22} className="animate-pulse-soft" color="var(--awriq-secondary)" />
        </div>
      ) : providers.length === 0 ? (
        <div className="awriq-card" style={{ padding: '48px', textAlign: 'center', gridColumn: '1 / -1' }}>
          <Cpu size={40} color="var(--awriq-border)" style={{ margin: '0 auto 12px' }} />
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', marginBottom: '16px' }}>لا مزوّدات بعد. اربط أول مزوّد مجاني أو تجريبي.</p>
          <button onClick={() => setShowAdd(true)} className="awriq-btn-primary">ربط مزوّد</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {providers.map((p) => (
            <div key={p.id} className={`awriq-card ${!p.is_enabled ? '' : ''}`} style={{ padding: '18px', opacity: p.is_enabled ? 1 : 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: p.is_free ? 'rgba(79,138,91,0.1)' : 'rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Cpu size={20} color={p.is_free ? '#4F8A5B' : '#C89B5A'} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--awriq-text)' }}>{p.name}</span>
                      <span className="awriq-badge" style={{ background: p.is_free ? 'rgba(79,138,91,0.1)' : 'rgba(200,155,90,0.1)', color: p.is_free ? '#4F8A5B' : '#8A5A2B' }}>{p.is_free ? 'مجاني' : 'مدفوع'}</span>
                      {p.config?.server_managed === true && (
                        <span className="awriq-badge" style={{ background: 'rgba(79,138,91,0.12)', color: '#4F8A5B', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <KeyRound size={11} /> السرّ في الخادم
                        </span>
                      )}
                      <span className="awriq-badge" style={{ background: p.is_enabled ? 'rgba(79,138,91,0.1)' : 'rgba(104,114,122,0.1)', color: p.is_enabled ? '#4F8A5B' : '#68727A' }}>{p.is_enabled ? 'مفعّل' : 'معطّل'}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', fontFamily: 'monospace', marginTop: '2px', direction: 'ltr', textAlign: 'left' }}>{p.base_url}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => toggleProvider(p)} title={p.is_enabled ? 'تعطيل' : 'تفعيل'} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--awriq-border)', background: 'transparent', color: p.is_enabled ? '#4F8A5B' : '#68727A', cursor: 'pointer', fontSize: '12px', fontFamily: 'Cairo, sans-serif' }}>
                    <Power size={14} /> {p.is_enabled ? 'تعطيل' : 'تفعيل'}
                  </button>
                  <button onClick={() => removeProvider(p)} title="حذف" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(201,75,75,0.4)', background: 'transparent', color: '#C94B4B', cursor: 'pointer', fontSize: '12px', fontFamily: 'Cairo, sans-serif' }}>
                    <Trash2 size={14} /> حذف
                  </button>
                </div>
              </div>

              <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Star size={13} /> النماذج ({p.models?.length ?? 0}) — انقر على نجمة لتعيين الافتراضي:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {p.models?.map(m => (
                  <span key={m.id} onClick={() => setDefaultModel(p, m.id)} title={m.is_default ? 'النموذج الافتراضي' : 'تعيين كافتراضي'} style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '6px',
                    background: m.is_default ? 'rgba(200,155,90,0.12)' : 'rgba(104,114,122,0.08)',
                    border: m.is_default ? '1px solid rgba(200,155,90,0.4)' : '1px solid transparent',
                    color: m.is_default ? '#8A5A2B' : 'var(--awriq-text)', fontSize: '12px', cursor: 'pointer', fontFamily: 'monospace',
                  }}>
                    {m.is_default ? <Star size={12} color="#C89B5A" /> : <Star size={12} color="transparent" stroke="currentColor" />}
                    {m.model_id}
                  </span>
                ))}
                {(!p.models || p.models.length === 0) && <span style={{ fontSize: '12px', color: 'var(--awriq-secondary)' }}>لا نماذج</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--awriq-surface)', borderRadius: '16px', width: '100%', maxWidth: '560px', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--awriq-border)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--awriq-text)', margin: 0 }}>ربط مزوّد جديد</h2>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--awriq-secondary)' }}><X size={22} /></button>
            </div>
            <form onSubmit={handleAdd} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>الاسم *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="awriq-input" placeholder="Groq / OpenRouter / Zen / VLLM محلي" />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>الرابط الأساسي *</label>
                <input type="text" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} className="awriq-input" placeholder="https://api.groq.com/openai/v1" dir="ltr" />
                <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)', marginTop: '4px' }}>
                  يلزم نقطة {`{base}/models`} و {`{base}/chat/completions`}.
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>المفتاح</label>
                  <input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} className="awriq-input" placeholder="اختياري للمجاني" dir="ltr" />
                </div>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>الأولوية (أصغر = يُجرَّب أولاً)</label>
                  <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className="awriq-input" style={{ direction: 'ltr' }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_free} onChange={(e) => setForm({ ...form, is_free: e.target.checked })} style={{ cursor: 'pointer' }} />
                  مزوّد مجاني
                </label>
                <button type="button" onClick={() => setForm({ ...form, auth_method: form.auth_method === 'bearer' ? 'none' : 'bearer' })} className="awriq-btn-secondary" style={{ fontSize: '12px', padding: '6px 12px' }}>
                  المصادقة: {form.auth_method === 'bearer' ? 'Bearer Token' : 'بدون'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowAdd(false)} className="awriq-btn-secondary">إلغاء</button>
                <button type="submit" disabled={probeLoading} className="awriq-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {probeLoading ? <Loader2 size={16} className="animate-pulse-soft" /> : <Link2 size={16} />}
                  {probeLoading ? 'جاري استكشاف النماذج...' : 'استكشاف وربط'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}