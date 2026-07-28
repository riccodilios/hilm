import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { ensureUserBootstrap } from '@/features/auth/bootstrap'
import { Skeleton } from '@/components/ui/page'

/**
 * Handles Supabase auth redirects: email verify, password recovery, magic links.
 * Configure Site URL + Redirect URLs in Supabase to point at /auth/callback on each environment.
 */
export function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [message, setMessage] = useState(t('auth.verifying'))

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const next = searchParams.get('next') || '/app'
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
          // Hash-based tokens (implicit / older flows)
          const { data, error } = await supabase.auth.getSession()
          if (error) throw error
          if (!data.session) {
            // Give client a moment to parse URL hash
            await new Promise((r) => setTimeout(r, 200))
            const again = await supabase.auth.getSession()
            if (again.error) throw again.error
            if (!again.data.session) {
              throw new Error(t('auth.callbackMissingSession'))
            }
          }
        }

        await ensureUserBootstrap()

        if (cancelled) return

        const isRecovery =
          type === 'recovery' || next.includes('reset-password')

        if (isRecovery) {
          toast.success(t('auth.recoveryReady'))
          navigate('/auth/reset-password', { replace: true })
          return
        }

        toast.success(t('auth.verified'))
        // Default post-verify destination: Dashboard
        const dest = next.startsWith('/') ? next : '/app'
        navigate(dest === '/' ? '/app' : dest, { replace: true })
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : t('auth.callbackFailed')
        setMessage(msg)
        toast.error(msg)
        setTimeout(() => navigate('/login', { replace: true }), 2500)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [navigate, searchParams, t])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
      <Skeleton className="h-10 w-48" />
      <p className="text-sm text-muted">{message}</p>
    </div>
  )
}
