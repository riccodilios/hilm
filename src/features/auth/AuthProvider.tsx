import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { getAppUrl, getAuthCallbackUrl } from '@/lib/env'
import {
  mapAuthError,
  normalizeEmail,
  withAuthRetry,
} from '@/lib/auth'
import { authDebug, rememberPendingVerifyEmail } from '@/lib/auth-debug'
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
        const normalized = normalizeEmail(email)
        authDebug('Signin:request', { email: normalized })
        const { error } = await withAuthRetry(() =>
          supabase.auth.signInWithPassword({
            email: normalized,
            password,
          }),
        )
        if (error) {
          authDebug('Signin:failure', { code: mapAuthError(error).key })
          throwMapped(error)
        }
        authDebug('Signin:success', { sessionCreated: true })
      },
      async signUp(email, password, displayName) {
        const normalized = normalizeEmail(email)
        const redirectTo = getAuthCallbackUrl('/onboarding')
        authDebug('Signup:request', {
          email: normalized,
          redirectTo,
          appUrl: getAppUrl(),
        })
        const { data, error } = await withAuthRetry(() =>
          supabase.auth.signUp({
            email: normalized,
            password,
            options: {
              data: { display_name: displayName?.trim() || undefined },
              emailRedirectTo: redirectTo,
            },
          }),
        )
        if (error) {
          authDebug('Signup:failure', { code: mapAuthError(error).key })
          throwMapped(error)
        }

        // Supabase returns success with empty identities when the email already exists
        // (anti-enumeration). Treat as already registered instead of "check your email".
        const identities = data.user?.identities ?? []
        if (!data.session && data.user && identities.length === 0) {
          authDebug('Signup:duplicateEmail', { email: normalized })
          throwMapped(new Error('User already registered'))
        }

        if (data.session) {
          try {
            await ensureUserBootstrap()
          } catch {
            // Non-blocking — callback/login can bootstrap later.
          }
          authDebug('Signup:success', {
            needsEmailConfirmation: false,
            sessionCreated: true,
          })
        } else {
          rememberPendingVerifyEmail(normalized)
          authDebug('Signup:confirmationEmail', {
            requested: true,
            needsEmailConfirmation: true,
            redirectTo,
          })
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
        const normalized = normalizeEmail(email)
        const redirectTo = getAuthCallbackUrl('/auth/reset-password')
        authDebug('ResetPassword:request', { email: normalized, redirectTo })
        const { error } = await withAuthRetry(() =>
          supabase.auth.resetPasswordForEmail(normalized, {
            redirectTo,
          }),
        )
        if (error) {
          authDebug('ResetPassword:failure', { code: mapAuthError(error).key })
          throwMapped(error)
        }
        authDebug('ResetPassword:emailRequested', { sent: true })
      },
      async resendSignupEmail(email) {
        const normalized = normalizeEmail(email)
        const redirectTo = getAuthCallbackUrl('/onboarding')
        authDebug('ResendVerification:request', { email: normalized, redirectTo })
        const { error } = await withAuthRetry(() =>
          supabase.auth.resend({
            type: 'signup',
            email: normalized,
            options: {
              emailRedirectTo: redirectTo,
            },
          }),
        )
        if (error) {
          authDebug('ResendVerification:failure', { code: mapAuthError(error).key })
          throwMapped(error)
        }
        rememberPendingVerifyEmail(normalized)
        authDebug('ResendVerification:sent', { email: normalized })
      },
      async signInWithMagicLink(email) {
        const normalized = normalizeEmail(email)
        const redirectTo = getAuthCallbackUrl('/onboarding')
        authDebug('MagicLink:request', { email: normalized, redirectTo })
        const { error } = await withAuthRetry(() =>
          supabase.auth.signInWithOtp({
            email: normalized,
            options: {
              emailRedirectTo: redirectTo,
              shouldCreateUser: true,
            },
          }),
        )
        if (error) {
          authDebug('MagicLink:failure', { code: mapAuthError(error).key })
          throwMapped(error)
        }
        authDebug('MagicLink:sent', { email: normalized })
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
