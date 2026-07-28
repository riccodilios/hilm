import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authErrorMessage, useAuth } from '@/features/auth/AuthProvider'
import { mapAuthError, normalizeEmail } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase/client'

export function LoginPage() {
  const { signIn, resendSignupEmail, user, loading } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [showResend, setShowResend] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  if (!loading && user) return <Navigate to="/app" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isSupabaseConfigured()) {
      toast.error(t('auth.missingEnv'))
      return
    }
    if (cooldown > 0) {
      toast.error(t('auth.errors.rateLimitWait', { seconds: cooldown }))
      return
    }
    setSubmitting(true)
    setShowResend(false)
    try {
      await signIn(normalizeEmail(email), password)
      toast.success(t('auth.welcomeBack'))
      navigate('/app')
    } catch (err) {
      const mapped = mapAuthError(err)
      if (mapped.key === 'auth.errors.emailNotConfirmed') setShowResend(true)
      const wait =
        err && typeof err === 'object' && 'waitSeconds' in err
          ? Number((err as { waitSeconds?: number }).waitSeconds) || 60
          : mapped.waitSeconds || 0
      if (wait > 0) setCooldown(wait)
      toast.error(authErrorMessage(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  async function onResend() {
    if (!email || cooldown > 0) return
    try {
      await resendSignupEmail(normalizeEmail(email))
      setCooldown(60)
      toast.success(t('auth.resendSent'))
    } catch (err) {
      const wait =
        err && typeof err === 'object' && 'waitSeconds' in err
          ? Number((err as { waitSeconds?: number }).waitSeconds) || 60
          : 0
      if (wait > 0) setCooldown(wait)
      toast.error(authErrorMessage(err, t))
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(96,165,250,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(52,211,153,0.08),_transparent_50%)]" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative w-full max-w-md rounded-2xl border border-border bg-surface/90 p-8 shadow-2xl backdrop-blur"
      >
        <div className="mb-8">
          <p className="text-sm text-muted">{t('brand.name')}</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">{t('auth.signInTitle')}</h1>
          <p className="mt-2 text-sm text-muted">{t('auth.signInSubtitle')}</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting || cooldown > 0}>
            {cooldown > 0
              ? t('auth.resendWait', { seconds: cooldown })
              : submitting
                ? t('auth.signingIn')
                : t('common.signIn')}
          </Button>
          {showResend ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={cooldown > 0}
              onClick={() => void onResend()}
            >
              {cooldown > 0
                ? t('auth.resendWait', { seconds: cooldown })
                : t('auth.resendEmail')}
            </Button>
          ) : null}
          <Link
            to="/auth/forgot-password"
            className="block text-center text-sm text-muted underline-offset-4 hover:text-foreground hover:underline"
          >
            {t('auth.forgotPassword')}
          </Link>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          {t('auth.noAccount')}{' '}
          <Link to="/signup" className="text-foreground underline-offset-4 hover:underline">
            {t('auth.createOne')}
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
