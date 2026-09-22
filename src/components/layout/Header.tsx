import { useState, useEffect, useRef } from 'react'
import { Menu, Bell, Search, Maximize2, Minimize2, Sun, Moon, ChevronDown } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useTheme } from '../../lib/theme'
import { supabase } from '../../lib/supabase'
import type { Notification } from '../../types'

interface HeaderProps {
  onMenuClick: () => void
  onToggleFullscreen: () => void
  isFullscreen: boolean
}

export default function Header({ onMenuClick, onToggleFullscreen, isFullscreen }: HeaderProps) {
  const { profile, roles, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const notifRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  const displayName = profile?.full_name_ar || profile?.full_name || 'مستخدم'
  const roleLabel = roles[0]?.name_ar || 'مستخدم'
  const unreadCount = notifications.filter(n => !n.is_read).length

  useEffect(() => {
    loadNotifications()
    const interval = setInterval(loadNotifications, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifPanel(false)
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadNotifications = async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)
    if (data) setNotifications(data as Notification[])
  }

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
  }

  return (
    <header style={{
      height: '64px',
      background: 'var(--awriq-surface)',
      borderBottom: '1px solid var(--awriq-border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 24px',
      gap: '16px',
      position: 'sticky',
      top: 0,
      zIndex: 30,
    }}>
      {/* Menu button - mobile */}
      <button
        onClick={onMenuClick}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--awriq-text)',
          cursor: 'pointer',
          padding: '8px',
          display: 'none',
        }}
        className="menu-toggle"
      >
        <Menu size={22} />
      </button>

      {/* Search */}
      <div style={{ flex: 1, maxWidth: '500px', position: 'relative' }}>
        <Search size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--awriq-secondary)' }} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ابحث في المدارس والمعاهد ..."
          className="awriq-input"
          style={{ padding: '9px 14px 9px 40px', fontSize: '13px' }}
        />
      </div>

      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--awriq-text)',
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--awriq-bg)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          title={theme === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح'}
        >
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </button>

        {/* Fullscreen */}
        <button
          onClick={onToggleFullscreen}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--awriq-text)',
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--awriq-bg)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          title={isFullscreen ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
        >
          {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
        </button>

        {/* Notifications */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowNotifPanel(!showNotifPanel)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--awriq-text)',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '8px',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--awriq-bg)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute',
                top: '4px',
                left: '4px',
                background: '#C94B4B',
                color: 'white',
                fontSize: '10px',
                fontWeight: 700,
                minWidth: '16px',
                height: '16px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px',
              }}>
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifPanel && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              left: 0,
              width: '360px',
              background: 'var(--awriq-surface)',
              border: '1px solid var(--awriq-border)',
              borderRadius: '12px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              zIndex: 100,
              maxHeight: '400px',
              overflowY: 'auto',
              animation: 'fadeIn 0.2s ease-out',
            }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--awriq-border)', fontSize: '14px', fontWeight: 700, color: 'var(--awriq-text)' }}>
                الإشعارات
              </div>
              {notifications.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--awriq-secondary)', fontSize: '13px' }}>
                  لا توجد إشعارات
                </div>
              ) : (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => markAsRead(notif.id)}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--awriq-border)',
                      cursor: 'pointer',
                      background: notif.is_read ? 'transparent' : 'rgba(200,155,90,0.05)',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--awriq-bg)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = notif.is_read ? 'transparent' : 'rgba(200,155,90,0.05)'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: notif.type === 'error' ? '#C94B4B' : notif.type === 'warning' ? '#C58A3A' : notif.type === 'success' ? '#4F8A5B' : notif.type === 'security' ? '#C94B4B' : '#8A5A2B',
                        flexShrink: 0,
                      }} />
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>
                        {notif.title_ar || notif.title}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--awriq-secondary)', paddingRight: '16px' }}>
                      {notif.message_ar || notif.message}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* User menu */}
        <div ref={userRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 10px 6px 6px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '8px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--awriq-bg)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
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
              color: 'white',
            }}>
              {displayName.charAt(0)}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--awriq-text)' }}>{displayName}</div>
              <div style={{ fontSize: '11px', color: 'var(--awriq-secondary)' }}>{roleLabel}</div>
            </div>
            <ChevronDown size={16} color="var(--awriq-secondary)" />
          </button>

          {showUserMenu && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              left: 0,
              width: '200px',
              background: 'var(--awriq-surface)',
              border: '1px solid var(--awriq-border)',
              borderRadius: '12px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              zIndex: 100,
              padding: '8px',
              animation: 'fadeIn 0.2s ease-out',
            }}>
              <div style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--awriq-secondary)', borderBottom: '1px solid var(--awriq-border)', marginBottom: '4px' }}>
                {profile?.full_name || 'مستخدم'}
              </div>
              <button
                onClick={() => { signOut(); window.location.href = '/login' }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  fontSize: '13px',
                  color: '#C94B4B',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  width: '100%',
                  borderRadius: '6px',
                  fontFamily: 'Cairo, sans-serif',
                  textAlign: 'right',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(201,75,75,0.08)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                تسجيل الخروج
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
