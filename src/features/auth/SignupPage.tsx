import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Mail } from 'lucide-react'
import { toast } from 'sonner'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authErrorMessage, useAuth } from '@/features/auth/AuthProvider'
import { PostAuthRedirect } from '@/features/auth/PostAuthRedirect'
import { resolvePostAuthDestination } from '@/features/auth/startup'
import { validateSignupInput } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase/client'

export function SignupPage() {
  const { signUp, resendSignupEmail, user, loading } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  if (!loading && user) return <PostAuthRedirect />

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

    const validated = validateSignupInput({ email, password, confirmPassword })
    if (!validated.ok) {
      toast.error(t(validated.key))
      return
    }

    setSubmitting(true)
    try {
      const result = await signUp(validated.email, password, displayName)
      if (!result.needsEmailConfirmation) {
        toast.success(t('auth.welcomeReady'))
        navigate(await resolvePostAuthDestination(), { replace: true })
        return
      }
      setPendingEmail(result.email)
      setCooldown(45)
      toast.success(t('auth.checkEmail'))
    } catch (err) {
      const wait =
        err && typeof err === 'object' && 'waitSeconds' in err
          ? Number((err as { waitSeconds?: number }).waitSeconds) || 60
          : 0
      if (wait > 0) setCooldown(wait)
      toast.error(authErrorMessage(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  async function onResend() {
    if (!pendingEmail || cooldown > 0) return
    setResending(true)
    try {
      await resendSignupEmail(pendingEmail)
      setCooldown(60)
      toast.success(t('auth.resendSent'))
    } catch (err) {
      const wait =
        err && typeof err === 'object' && 'waitSeconds' in err
          ? Number((err as { waitSeconds?: number }).waitSeconds) || 60
          : 0
      if (wait > 0) setCooldown(wait)
      toast.error(authErrorMessage(err, t))
    } finally {
      setResending(false)
    }
  }

  if (pendingEmail) {
    return (
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(96,165,250,0.12),_transparent_55%)]" />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative w-full max-w-md rounded-2xl border border-border bg-surface/90 p-8 shadow-2xl backdrop-blur"
        >
          <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <Mail className="size-6" />
          </div>
          <h1 className="text-2xl font-medium tracking-tight">{t('auth.checkEmailTitle')}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            {t('auth.checkEmailBody', { email: pendingEmail })}
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            <li>• {t('auth.checkEmailTip1')}</li>
            <li>• {t('auth.checkEmailTip2')}</li>
            <li>• {t('auth.checkEmailTip3')}</li>
          </ul>
          <div className="mt-6 space-y-3">
            <Button
              type="button"
              className="w-full"
              disabled={resending || cooldown > 0}
              onClick={() => void onResend()}
            >
              {cooldown > 0
                ? t('auth.resendWait', { seconds: cooldown })
                : resending
                  ? t('auth.resending')
                  : t('auth.resendEmail')}
            </Button>
            <Button type="button" variant="secondary" className="w-full" asChild>
              <Link to="/login">{t('common.signIn')}</Link>
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => {
                setPendingEmail(null)
                setPassword('')
                setConfirmPassword('')
              }}
            >
              {t('auth.useDifferentEmail')}
            </button>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(96,165,250,0.12),_transparent_55%)]" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md rounded-2xl border border-border bg-surface/90 p-8 shadow-2xl backdrop-blur"
      >
        <div className="mb-8 flex items-start justify-between gap-3">
          <div>
          <p className="text-sm text-muted">{t('brand.name')}</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">{t('auth.signUpTitle')}</h1>
          <p className="mt-2 text-sm text-muted">{t('auth.signUpSubtitle')}</p>
          </div>
          <LanguageSwitcher compact />
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('auth.displayName')}</Label>
            <Input
              id="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          </div>
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
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="text-xs text-muted">{t('auth.passwordHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">{t('auth.confirmPassword')}</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting || cooldown > 0}>
            {cooldown > 0
              ? t('auth.resendWait', { seconds: cooldown })
              : submitting
                ? t('auth.creating')
                : t('common.signUp')}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          {t('auth.hasAccount')}{' '}
          <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
            {t('common.signIn')}
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
