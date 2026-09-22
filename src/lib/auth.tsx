import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Role, UserProfile } from '../types'

interface AuthContextType {
  session: Session | null
  profile: UserProfile | null
  roles: Role[]
  loading: boolean
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

  const loadProfile = useCallback(async (userId: string) => {
    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (profileData) {
      setProfile(profileData as UserProfile)
    } else {
      const { data: newProfile } = await supabase
        .from('user_profiles')
        .insert({
          user_id: userId,
          full_name: '',
          is_active: true,
          last_login_at: new Date().toISOString(),
        })
        .select('*')
        .maybeSingle()
      if (newProfile) setProfile(newProfile as UserProfile)
    }

    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role_id, roles(*)')
      .eq('user_id', userId)

    if (userRoles) {
      const roleList = userRoles.map((ur) => ur.roles).filter(Boolean) as unknown as Role[]
      setRoles(roleList)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session?.user?.id) {
      await loadProfile(session.user.id)
    }
  }, [session, loadProfile])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user?.id) {
        loadProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user?.id) {
        (async () => {
          await loadProfile(session.user.id)
          setLoading(false)
        })()
      } else {
        setProfile(null)
        setRoles([])
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [loadProfile])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }

  const signUp = async (email: string, password: string, fullName: string) => {
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
    <AuthContext.Provider value={{ session, profile, roles, loading, signIn, signUp, signOut, refreshProfile, hasPermission, hasRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
