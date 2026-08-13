import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authErrorMessage, useAuth } from '@/features/auth/AuthProvider'
import { normalizeEmail } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase/client'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isSupabaseConfigured()) {
      toast.error(t('auth.missingEnv'))
      return
    }
    setSubmitting(true)
    try {
      await resetPassword(normalizeEmail(email))
      setSent(true)
      toast.success(t('auth.resetEmailSent'))
    } catch (err) {
      toast.error(authErrorMessage(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface/90 p-8">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
        <h1 className="text-2xl font-medium tracking-tight">{t('auth.forgotTitle')}</h1>
        <p className="mt-2 text-sm text-muted">{t('auth.forgotSubtitle')}</p>
          </div>
          <LanguageSwitcher compact />
        </div>
        {sent ? (
          <p className="mt-6 text-sm text-muted">{t('auth.resetEmailSent')}</p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t('common.loading') : t('auth.sendReset')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted">
          <Link to="/login" className="underline-offset-4 hover:underline">
            {t('common.signIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
