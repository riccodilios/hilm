import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, MailWarning } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { ensureUserBootstrap } from '@/features/auth/bootstrap'
import { resolvePostAuthDestination } from '@/features/auth/startup'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/page'
import { normalizeEmail } from '@/lib/auth'

type Phase = 'working' | 'success' | 'error'

/**
 * Handles Supabase auth redirects: email verify, password recovery, magic links.
 * Site URL + Redirect URLs must be set in Supabase Dashboard to the deployed domain
 * (and localhost only for local). Client never hardcodes localhost for production.
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

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const nextParam = searchParams.get('next')
        const code = searchParams.get('code')
        const type = searchParams.get('type')
        const errorDescription = searchParams.get('error_description')
        const errorCode = searchParams.get('error')

        if (errorCode || errorDescription) {
          throw new Error(errorDescription || errorCode || 'Authentication failed')
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        } else {
          const { data, error } = await supabase.auth.getSession()
          if (error) throw error
          if (!data.session) {
            await new Promise((r) => setTimeout(r, 250))
            const again = await supabase.auth.getSession()
            if (again.error) throw again.error
            if (!again.data.session) {
              throw new Error(t('auth.callbackMissingSession'))
            }
          }
        }

        await ensureUserBootstrap()
        if (cancelled) return

        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user?.email) setResendEmail(user.email)

        const isRecovery =
          type === 'recovery' || (nextParam ?? '').includes('reset-password')

        if (isRecovery) {
          toast.success(t('auth.recoveryReady'))
          navigate('/auth/reset-password', { replace: true })
          return
        }

        let dest: string = await resolvePostAuthDestination()
        if (nextParam?.startsWith('/personal/') || nextParam?.startsWith('/workspace')) {
          dest = nextParam
        }
        setDestination(dest)
        setPhase('success')
        setMessage(t('auth.emailVerifiedBody'))
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : t('auth.callbackFailed')
        setMessage(msg)
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

  if (phase === 'success') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6">
        <div className="w-full max-w-md rounded-3xl border border-border-subtle bg-surface/50 p-8 text-center shadow-xl">
          <CheckCircle2 className="mx-auto size-12 text-success" />
          <h1 className="mt-4 text-2xl font-medium tracking-tight">{t('auth.emailVerifiedTitle')}</h1>
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
        <div className="mt-8 space-y-2">
          <Button className="w-full" onClick={() => window.location.reload()}>
            {t('auth.retryVerify')}
          </Button>
          <Button
            className="w-full"
            variant="secondary"
            disabled={resending || !resendEmail}
            onClick={async () => {
              if (!resendEmail) {
                toast.error(t('auth.resendNeedsEmail'))
                return
              }
              setResending(true)
              try {
                await resendSignupEmail(normalizeEmail(resendEmail))
                toast.success(t('auth.resendOk'))
              } catch (error) {
                toast.error(error instanceof Error ? error.message : t('auth.callbackFailed'))
              } finally {
                setResending(false)
              }
            }}
          >
            {t('auth.resendVerification')}
          </Button>
          <Button asChild className="w-full" variant="ghost">
            <Link to="/login">{t('auth.backToLogin')}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
