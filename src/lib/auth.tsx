import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Role, UserProfile } from '../types'

interface AuthContextType {
  session: Session | null
  profile: UserProfile | null
  roles: Role[]
  loading: boolean
  authError: string | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  hasPermission: (permissionCode: string) => boolean
  hasRole: (roleName: string) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const initializedRef = useRef(false)
  const currentUserIdRef = useRef<string | null>(null)

  const loadProfile = useCallback(async (userId: string) => {
    if (currentUserIdRef.current === userId) return
    currentUserIdRef.current = userId

    try {
      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

      if (profileError) {
        setAuthError('فشل تحميل بيانات المستخدم')
        setLoading(false)
        return
      }

      if (profileData) {
        setProfile(profileData as UserProfile)
      } else {
        const { data: newProfile, error: insertError } = await supabase
          .from('user_profiles')
          .insert({
            user_id: userId,
            full_name: '',
            is_active: true,
            last_login_at: new Date().toISOString(),
          })
          .select('*')
          .maybeSingle()
        if (insertError) {
          setAuthError('فشل إنشاء ملف المستخدم')
          setLoading(false)
          return
        }
        if (newProfile) setProfile(newProfile as UserProfile)
      }

      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('role_id, roles(*)')
        .eq('user_id', userId)

      if (rolesError) {
        setAuthError('فشل تحميل صلاحيات المستخدم')
        setLoading(false)
        return
      }

      if (userRoles) {
        const roleList = userRoles.map((ur) => ur.roles).filter(Boolean) as unknown as Role[]
        setRoles(roleList)
      }

      setAuthError(null)
    } catch {
      setAuthError('حدث خطأ غير متوقع أثناء تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    const userId = currentUserIdRef.current
    if (userId) {
      currentUserIdRef.current = null
      await loadProfile(userId)
    }
  }, [loadProfile])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    let mounted = true

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) {
        setAuthError('فشل الاتصال بخدمة المصادقة')
        setLoading(false)
        return
      }

      setSession(data.session)
      if (data.session?.user?.id) {
        loadProfile(data.session.user.id)
      } else {
        setLoading(false)
      }
    }).catch(() => {
      if (!mounted) return
      setAuthError('فشل الاتصال بخدمة المصادقة')
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return

      if (event === 'TOKEN_REFRESHED' && newSession?.user?.id === currentUserIdRef.current) {
        setSession(newSession)
        return
      }

      setSession(newSession)

      if (newSession?.user?.id) {
        if (newSession.user.id !== currentUserIdRef.current) {
          currentUserIdRef.current = null
          loadProfile(newSession.user.id)
        } else {
          setLoading(false)
        }
      } else {
        currentUserIdRef.current = null
        setProfile(null)
        setRoles([])
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = async (email: string, password: string) => {
    setAuthError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }

  const signUp = async (email: string, password: string, fullName: string) => {
    setAuthError(null)
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { error: error.message }

    if (data.user) {
      await supabase.from('user_profiles').insert({
        user_id: data.user.id,
        full_name: fullName,
        is_active: true,
      })
    }
    return { error: null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    currentUserIdRef.current = null
    setProfile(null)
    setRoles([])
  }

  const hasPermission = useCallback((_permissionCode: string) => {
    if (roles.some(r => r.name === 'super_admin')) return true
    return false
  }, [roles])

  const hasRole = useCallback((roleName: string) => {
    return roles.some(r => r.name === roleName)
  }, [roles])

  return (
    <AuthContext.Provider value={{ session, profile, roles, loading, authError, signIn, signUp, signOut, refreshProfile, hasPermission, hasRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
