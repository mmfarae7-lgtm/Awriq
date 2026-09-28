import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Eye, EyeOff, Loader2, Lock, Mail, ShieldAlert } from 'lucide-react'

const ATTEMPT_LIMIT = 5
const LOCK_MS = 60_000
const FAILS_KEY = 'awriq_login_fails'
const LOCK_KEY = 'awriq_login_lock_until'

function readFails(): number {
  try { return Number(sessionStorage.getItem(FAILS_KEY) || '0') } catch { return 0 }
}
function lockRemaining(): number {
  try {
    const until = Number(sessionStorage.getItem(LOCK_KEY) || '0')
    return Math.max(0, until - Date.now())
  } catch { return 0 }
}

export default function LoginPage() {
  const { signIn } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lockMs, setLockMs] = useState(lockRemaining)
  const [savedEmail, setSavedEmail] = useState('')

  const recordLoginEvent = async (eventType: string, severity: string, description: string, metadata: Record<string, unknown> = {}) => {
    try {
      await supabase.from('security_events').insert({
        event_type: eventType,
        severity,
        description,
        metadata,
      })
    } catch {
      /* client-side log only; never blocks the user */
    }
  }

  const applyLock = (fails: number) => {
    const until = Date.now() + LOCK_MS
    try {
      sessionStorage.setItem(FAILS_KEY, String(fails))
      sessionStorage.setItem(LOCK_KEY, String(until))
    } catch { /* ignore */ }
    setSavedEmail(email)
    setLockMs(LOCK_MS)
    showToast('محاولات دخول خاطئة كثيرة — عُطّلت الصفحة 60 ثانية. سُجّل الحدث.', 'warning')
    void recordLoginEvent('login_failed', 'high', `قفل مؤقت بعد ${fails} محاولة فاشلة (${email})`, { reason: 'too_many_attempts', email })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      showToast('يرجى ملء جميع الحقول المطلوبة', 'warning')
      return
    }
    if (lockMs > 0) {
      showToast(`المحاولات معلّقة — حاول مجددًا بعد ${Math.ceil(lockMs / 1000)} ثانية`, 'warning')
      return
    }

    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) {
      const fails = readFails() + 1
      if (fails >= ATTEMPT_LIMIT) {
        applyLock(fails)
      } else {
        try { sessionStorage.setItem(FAILS_KEY, String(fails)) } catch { /* ignore */ }
        void recordLoginEvent('login_failed', 'medium', `محاولة دخول فاشلة (${email})`, { reason: 'wrong_credentials', email })
        showToast(error === 'Invalid login credentials' ? 'بيانات الدخول غير صحيحة' : error, 'error')
      }
    } else {
      showToast('تم تسجيل الدخول بنجاح', 'success')
      try { sessionStorage.removeItem(FAILS_KEY); sessionStorage.removeItem(LOCK_KEY) } catch { /* ignore */ }
      navigate('/')
    }
    setLoading(false)
  }

  useEffect(() => {
    const id = setInterval(() => {
      const left = lockRemaining()
      setLockMs(left > 0 ? left : 0)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--awriq-bg)',
      padding: '32px 20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* subtle ambient glows — quiet, not busy */}
      <div style={{
        position: 'absolute',
        top: '-120px',
        right: '-80px',
        width: '360px',
        height: '360px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(200,155,90,0.10) 0%, transparent 62%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-140px',
        left: '-100px',
        width: '420px',
        height: '420px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(138,90,43,0.08) 0%, transparent 62%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: '420px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        {/* Brand — the primary visual element */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <img
            src="/awriq-logo.svg"
            alt="AWRIQ"
            width={84}
            height={84}
            style={{
              display: 'block',
              margin: '0 auto 20px',
              filter: 'drop-shadow(0 6px 18px rgba(200,155,90,0.28))',
            }}
          />
          <h1 style={{
            fontSize: '32px',
            fontWeight: 800,
            color: 'var(--awriq-text)',
            margin: 0,
            letterSpacing: '2px',
            lineHeight: 1.2,
          }}>
            AWRIQ
          </h1>
          <div style={{
            width: '34px',
            height: '2px',
            margin: '10px auto 0',
            borderRadius: '1px',
            background: 'linear-gradient(90deg, #C89B5A, #8A5A2B)',
          }} />
          {/* short intro — sits beside/under the logo, not a full-width section */}
          <p style={{
            fontSize: '14px',
            color: 'var(--awriq-secondary)',
            lineHeight: 1.7,
            margin: '16px auto 0',
            maxWidth: '340px',
          }}>
            أوراق — إدارة مستقلة للنظام التعليمي، من لوحة واحدة.
          </p>
        </div>

        {/* Login card — the primary element, centered */}
        <div style={{
          width: '100%',
          background: 'var(--awriq-surface)',
          border: '1px solid var(--awriq-border)',
          borderRadius: '16px',
          padding: '32px',
          boxShadow: '0 12px 40px rgba(29, 39, 48, 0.08)',
        }}>
          <h2 style={{
            fontSize: '19px',
            fontWeight: 700,
            color: 'var(--awriq-text)',
            margin: '0 0 6px',
          }}>
            تسجيل الدخول
          </h2>
          <p style={{
            fontSize: '13px',
            color: 'var(--awriq-secondary)',
            margin: '0 0 24px',
          }}>
            أدخل بياناتك للوصول إلى لوحة التحكم
          </p>

          {lockMs > 0 && (
            <div style={{
              background: 'rgba(201,75,75,0.08)',
              border: '1px solid rgba(201,75,75,0.25)',
              color: '#C94B4B',
              borderRadius: '10px',
              padding: '11px 14px',
              marginBottom: '16px',
              fontSize: '13px',
              lineHeight: 1.7,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}>
              <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>
                عُطّلت محاولات الدخول لمدة <strong>{Math.ceil(lockMs / 1000)}</strong> ثانية بعد {ATTEMPT_LIMIT} محاولات فاشلة.
                سُجّل هذا الحدث في سجل الأمان. جارٍ الصيغة التالية: <span style={{ direction: 'ltr', display: 'inline-block' }}>{savedEmail}</span>
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--awriq-text)',
                marginBottom: '6px',
                display: 'block',
              }}>
                البريد الإلكتروني
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={17} style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--awriq-secondary)',
                  pointerEvents: 'none',
                }} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@awriq.com"
                  autoComplete="username"
                  dir="ltr"
                  className="awriq-input"
                  style={{ padding: '12px 40px 12px 14px', fontSize: '14px', borderRadius: '10px' }}
                />
              </div>
            </div>

            <div>
              <label style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--awriq-text)',
                marginBottom: '6px',
                display: 'block',
              }}>
                كلمة المرور
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={17} style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--awriq-secondary)',
                  pointerEvents: 'none',
                }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  dir="ltr"
                  className="awriq-input"
                  style={{ padding: '12px 40px 12px 40px', fontSize: '14px', borderRadius: '10px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--awriq-secondary)',
                    padding: 0,
                    display: 'flex',
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || lockMs > 0}
              className="awriq-btn-primary"
              style={{
                width: '100%',
                padding: '13px',
                fontSize: '15px',
                borderRadius: '10px',
                marginTop: '6px',
                opacity: loading ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              {loading ? (<>
                <Loader2 size={17} className="animate-pulse-soft" /> جاري المعالجة...
              </>) : 'دخول'}
            </button>
          </form>
        </div>

        <p style={{
          textAlign: 'center',
          fontSize: '12px',
          color: 'var(--awriq-secondary)',
          margin: '20px 0 0',
          opacity: 0.85,
        }}>
          AWRIQ — نسخة التشغيل الآمنة
        </p>
      </div>
    </div>
  )
}