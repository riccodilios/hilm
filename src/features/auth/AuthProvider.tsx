import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { getAuthCallbackUrl } from '@/lib/env'
import {
  mapAuthError,
  normalizeEmail,
  withAuthRetry,
} from '@/lib/auth'
import { ensureUserBootstrap } from '@/features/auth/bootstrap'

export type SignUpResult = {
  email: string
  needsEmailConfirmation: boolean
}

type AuthContextValue = {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName?: string) => Promise<SignUpResult>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  resendSignupEmail: (email: string) => Promise<void>
  signInWithMagicLink: (email: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function throwMapped(error: unknown): never {
  const info = mapAuthError(error)
  const err = new Error(info.key) as Error & { authKey: string; waitSeconds?: number }
  err.authKey = info.key
  err.waitSeconds = info.waitSeconds
  throw err
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      async signIn(email, password) {
        const { error } = await withAuthRetry(() =>
          supabase.auth.signInWithPassword({
            email: normalizeEmail(email),
            password,
          }),
        )
        if (error) throwMapped(error)
      },
      async signUp(email, password, displayName) {
        const normalized = normalizeEmail(email)
        const { data, error } = await withAuthRetry(() =>
          supabase.auth.signUp({
            email: normalized,
            password,
            options: {
              data: { display_name: displayName?.trim() || undefined },
              emailRedirectTo: getAuthCallbackUrl('/app'),
            },
          }),
        )
        if (error) throwMapped(error)

        // If email confirmation is off, session is returned immediately.
        if (data.session) {
          try {
            await ensureUserBootstrap()
          } catch {
            // Non-blocking — callback/login can bootstrap later.
          }
        }

        return {
          email: normalized,
          needsEmailConfirmation: !data.session,
        }
      },
      async signOut() {
        const { error } = await supabase.auth.signOut()
        if (error) throwMapped(error)
      },
      async resetPassword(email) {
        const { error } = await withAuthRetry(() =>
          supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
            redirectTo: getAuthCallbackUrl('/auth/reset-password'),
          }),
        )
        if (error) throwMapped(error)
      },
      async resendSignupEmail(email) {
        const { error } = await withAuthRetry(() =>
          supabase.auth.resend({
            type: 'signup',
            email: normalizeEmail(email),
            options: {
              emailRedirectTo: getAuthCallbackUrl('/app'),
            },
          }),
        )
        if (error) throwMapped(error)
      },
      async signInWithMagicLink(email) {
        const { error } = await withAuthRetry(() =>
          supabase.auth.signInWithOtp({
            email: normalizeEmail(email),
            options: {
              emailRedirectTo: getAuthCallbackUrl('/app'),
              shouldCreateUser: true,
            },
          }),
        )
        if (error) throwMapped(error)
      },
    }),
    [session, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function authErrorMessage(error: unknown, t: (key: string) => string) {
  if (error && typeof error === 'object' && 'authKey' in error) {
    const key = String((error as { authKey: string }).authKey)
    const translated = t(key)
    return translated === key ? t('auth.errors.generic') : translated
  }
  if (error instanceof Error) {
    const translated = t(error.message)
    if (translated !== error.message) return translated
  }
  const mapped = mapAuthError(error)
  const translated = t(mapped.key)
  return translated === mapped.key ? t('auth.errors.generic') : translated
}
