import { NavLink, useNavigate } from 'react-router-dom'
import { Feather, Home, Building2, Users, Cable, BarChart3, Bell, History, Settings, LifeBuoy, LogOut, X, Bot, FolderGit2, Shield } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

const menuItems = [
  { path: '/', label: 'الرئيسية', icon: Home },
  { path: '/institutions', label: 'المدارس والمعاهد', icon: Building2 },
  { path: '/users', label: 'المستخدمون', icon: Users },
  { path: '/connections', label: 'الربط والأنظمة', icon: Cable },
  { path: '/agent-room', label: 'غرفة الوكيل البرمجي', icon: Bot },
  { path: '/projects', label: 'المشاريع', icon: FolderGit2 },
  { path: '/reports', label: 'التقارير', icon: BarChart3 },
  { path: '/notifications', label: 'الإشعارات', icon: Bell },
  { path: '/activity', label: 'سجل النشاط', icon: History },
  { path: '/security', label: 'الأمان', icon: Shield },
  { path: '/access-tokens', label: 'Access Tokens', icon: Cable },
  { path: '/settings', label: 'الإعدادات', icon: Settings },
  { path: '/support', label: 'الدعم الفني', icon: LifeBuoy },
]

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { signOut, profile, roles } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    showToast('تم تسجيل الخروج بنجاح', 'success')
    navigate('/login')
  }

  const displayName = profile?.full_name_ar || profile?.full_name || 'مستخدم'
  const roleLabel = roles[0]?.name_ar || 'مستخدم'

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 49 }}
          className="md:hidden"
        />
      )}

      <aside
        style={{
          width: '240px',
          background: 'var(--awriq-sidebar)',
          color: '#E6DED3',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s ease',
        }}
        className="sidebar-desktop"
      >
        {/* Logo section */}
        <div style={{ padding: '24px 20px', borderBottom: '1px solid rgba(200,155,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #C89B5A 0%, #8A5A2B 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Feather size={24} color="#111820" strokeWidth={2.5} />
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#C89B5A', letterSpacing: '1px' }}>AWRIQ</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#E6DED3' }}>أوراق</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#68727A', cursor: 'pointer', display: 'none' }}
            className="md:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '16px 12px', overflowY: 'auto' }}>
          {menuItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#C89B5A' : '#8A95A0',
                  textDecoration: 'none',
                  marginBottom: '4px',
                  background: isActive ? 'rgba(200,155,90,0.1)' : 'transparent',
                  transition: 'all 0.2s',
                  borderRight: isActive ? '3px solid #C89B5A' : '3px solid transparent',
                })}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* User section */}
        <div style={{ padding: '16px 12px', borderTop: '1px solid rgba(200,155,90,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', marginBottom: '8px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #C89B5A 0%, #8A5A2B 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: 700,
              color: '#111820',
              flexShrink: 0,
            }}>
              {displayName.charAt(0)}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#E6DED3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
              <div style={{ fontSize: '11px', color: '#68727A' }}>{roleLabel}</div>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              color: '#C94B4B',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              width: '100%',
              transition: 'background 0.2s',
              fontFamily: 'Cairo, sans-serif',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(201,75,75,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <LogOut size={18} />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>
    </>
  )
}
