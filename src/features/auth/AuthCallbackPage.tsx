import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, MailWarning } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { ensureUserBootstrap } from '@/features/auth/bootstrap'
import { resolvePostAuthDestination } from '@/features/auth/startup'
import { authErrorMessage, useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/page'
import { normalizeEmail } from '@/lib/auth'
import {
  authDebug,
  clearPendingVerifyEmail,
  readPendingVerifyEmail,
} from '@/lib/auth-debug'
import { completeAuthCallback, mapCallbackError } from '@/lib/auth-callback'
import { isSafeAuthNext, parseAuthCallbackParams } from '@/lib/auth-callback-params'

type Phase = 'working' | 'success' | 'error' | 'already'

/**
 * Handles Supabase auth redirects: email verify, password recovery, magic links.
 * Site URL + Redirect URLs must be set in Supabase Dashboard to the deployed domain
 * (and localhost:5173 only for local). Client never hardcodes localhost for production.
 */
export function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { resendSignupEmail } = useAuth()
  const [phase, setPhase] = useState<Phase>('working')
  const [message, setMessage] = useState(t('auth.verifying'))
  const [destination, setDestination] = useState('/personal')
  const [resendEmail, setResendEmail] = useState('')
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [resendCooldown])

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const params = parseAuthCallbackParams(searchParams)
        const nextParam = searchParams.get('next')

        authDebug('Callback:redirect', {
          next: nextParam,
          pathname: window.location.pathname,
        })

        await completeAuthCallback(params)
        if (cancelled) return

        await ensureUserBootstrap()
        if (cancelled) return

        const {
          data: { user },
        } = await supabase.auth.getUser()

        const email =
          user?.email ||
          params.email ||
          readPendingVerifyEmail() ||
          ''
        if (email) setResendEmail(email)

        const isRecovery =
          params.type === 'recovery' || (nextParam ?? '').includes('reset-password')

        if (isRecovery) {
          toast.success(t('auth.recoveryReady'))
          navigate('/auth/reset-password', { replace: true })
          return
        }

        let dest: string = await resolvePostAuthDestination()
        if (nextParam && isSafeAuthNext(nextParam)) {
          dest = nextParam
        }

        clearPendingVerifyEmail()
        authDebug('Callback:session', { sessionCreated: true, destination: dest })
        setDestination(dest)
        setPhase('success')
        setMessage(t('auth.emailVerifiedBody'))
      } catch (err) {
        if (cancelled) return
        const key = mapCallbackError(err)
        const pending = readPendingVerifyEmail()
        const params = parseAuthCallbackParams(searchParams)
        const emailHint = params.email || pending
        if (emailHint) setResendEmail(emailHint)

        if (key === 'auth.errors.alreadyVerified') {
          setPhase('already')
          setMessage(t('auth.alreadyVerifiedBody'))
          setDestination(await resolvePostAuthDestination())
          return
        }

        authDebug('Callback:failure', { code: key })
        setMessage(authErrorMessage(err, t))
        setPhase('error')
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [navigate, searchParams, t])

  if (phase === 'working') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
        <Skeleton className="h-12 w-12 rounded-full" />
        <p className="text-sm text-muted">{message}</p>
      </div>
    )
  }

  if (phase === 'success' || phase === 'already') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6">
        <div className="w-full max-w-md rounded-3xl border border-border-subtle bg-surface/50 p-8 text-center shadow-xl">
          <CheckCircle2 className="mx-auto size-12 text-success" />
          <h1 className="mt-4 text-2xl font-medium tracking-tight">
            {phase === 'already' ? t('auth.alreadyVerifiedTitle') : t('auth.emailVerifiedTitle')}
          </h1>
          <p className="mt-2 text-sm text-muted">{message}</p>
          <Button className="mt-8 w-full" onClick={() => navigate(destination, { replace: true })}>
            {t('auth.continueToApp')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-md rounded-3xl border border-danger/30 bg-surface/50 p-8 text-center shadow-xl">
        <MailWarning className="mx-auto size-12 text-danger" />
        <h1 className="mt-4 text-2xl font-medium tracking-tight">{t('auth.verifyFailedTitle')}</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <div className="mt-8 space-y-3 text-start">
          <div className="space-y-2">
            <Label htmlFor="callback-resend-email">{t('auth.email')}</Label>
            <Input
              id="callback-resend-email"
              type="email"
              autoComplete="email"
              value={resendEmail}
              onChange={(event) => setResendEmail(event.target.value)}
              placeholder={t('auth.resendEmailPlaceholder')}
            />
          </div>
          <Button className="w-full" onClick={() => window.location.reload()}>
            {t('auth.retryVerify')}
          </Button>
          <Button
            className="w-full"
            variant="secondary"
            disabled={resending || resendCooldown > 0 || !resendEmail.trim()}
            onClick={async () => {
              setResending(true)
              try {
                await resendSignupEmail(normalizeEmail(resendEmail))
                setResendCooldown(60)
                toast.success(t('auth.resendOk'))
              } catch (error) {
                toast.error(authErrorMessage(error, t))
              } finally {
                setResending(false)
              }
            }}
          >
            {resendCooldown > 0
              ? t('auth.resendWait', { seconds: resendCooldown })
              : resending
                ? t('auth.resending')
                : t('auth.resendVerification')}
          </Button>
          <Button asChild className="w-full" variant="ghost">
            <Link to="/login">{t('auth.backToLogin')}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
