import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, Mail, Feather } from 'lucide-react'

export default function LoginPage() {
  const { signIn, signUp } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      showToast('يرجى ملء جميع الحقول المطلوبة', 'warning')
      return
    }

    setLoading(true)
    if (mode === 'login') {
      const { error } = await signIn(email, password)
      if (error) {
        showToast(error === 'Invalid login credentials' ? 'بيانات الدخول غير صحيحة' : error, 'error')
      } else {
        showToast('تم تسجيل الدخول بنجاح', 'success')
        navigate('/')
      }
    } else {
      if (!fullName) {
        showToast('يرجى إدخال الاسم الكامل', 'warning')
        setLoading(false)
        return
      }
      if (password.length < 6) {
        showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'warning')
        setLoading(false)
        return
      }
      const { error } = await signUp(email, password, fullName)
      if (error) {
        showToast(error === 'User already registered' ? 'المستخدم مسجل بالفعل' : error, 'error')
      } else {
        showToast('تم إنشاء الحساب بنجاح', 'success')
        navigate('/')
      }
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--awriq-bg)' }}>
      {/* Left panel - branding */}
      <div style={{
        flex: '1.2',
        background: 'linear-gradient(135deg, #111820 0%, #1A222B 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0, left: 0,
          background: 'radial-gradient(circle at 70% 30%, rgba(200,155,90,0.08) 0%, transparent 50%)',
        }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
          <div style={{
            width: '80px',
            height: '80px',
            margin: '0 auto 24px',
            borderRadius: '20px',
            background: 'linear-gradient(135deg, #C89B5A 0%, #8A5A2B 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(200,155,90,0.3)',
          }}>
            <Feather size={40} color="#111820" strokeWidth={2.5} />
          </div>
          <h1 style={{ fontSize: '42px', fontWeight: 800, color: '#C89B5A', margin: '0 0 8px', letterSpacing: '2px' }}>
            AWRIQ
          </h1>
          <h2 style={{ fontSize: '28px', fontWeight: 700, color: '#E6DED3', margin: '0 0 16px' }}>
            أوراق
          </h2>
          <p style={{ fontSize: '16px', color: '#68727A', maxWidth: '400px', lineHeight: '1.6' }}>
            النظام الشامل لإدارة المعاهد والمدارس والأنظمة التعليمية المستقلة
          </p>
          <div style={{ marginTop: '48px', display: 'flex', gap: '24px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { label: 'إدارة مركزية', value: 'لوحة تحكم موحدة' },
              { label: 'ربط آمن', value: 'أنظمة مستقلة' },
              { label: 'مراقبة حية', value: 'حالة الاتصال' },
            ].map((item, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '14px', color: '#C89B5A', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
                <div style={{ fontSize: '12px', color: '#68727A' }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel - form */}
      <div style={{
        flex: '1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px',
      }}>
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--awriq-text)', marginBottom: '8px' }}>
            {mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب جديد'}
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--awriq-secondary)', marginBottom: '32px' }}>
            {mode === 'login' ? 'أدخل بياناتك للوصول إلى لوحة التحكم' : 'أنشئ حسابك للبدء مع نظام أوراق'}
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {mode === 'signup' && (
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>
                  الاسم الكامل
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="أدخل اسمك الكامل"
                  className="awriq-input"
                  style={{ padding: '12px 14px 12px 40px' }}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>
                البريد الإلكتروني
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--awriq-secondary)' }} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@awriq.com"
                  className="awriq-input"
                  style={{ padding: '12px 14px 12px 40px' }}
                  dir="ltr"
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)', marginBottom: '6px', display: 'block' }}>
                كلمة المرور
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--awriq-secondary)' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="awriq-input"
                  style={{ padding: '12px 40px 12px 40px' }}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--awriq-secondary)', padding: 0 }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="awriq-btn-primary"
              style={{ padding: '14px', fontSize: '15px', marginTop: '8px', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'جاري المعالجة...' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '24px' }}>
            <button
              onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
              style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '14px', fontFamily: 'Cairo, sans-serif', fontWeight: 600 }}
            >
              {mode === 'login' ? 'ليس لديك حساب؟ إنشاء حساب جديد' : 'لديك حساب بالفعل؟ تسجيل الدخول'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
