import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { getAuthCallbackUrl } from '@/lib/env'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
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
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getAuthCallbackUrl('/auth/reset-password'),
      })
      if (error) throw error
      setSent(true)
      toast.success(t('auth.resetEmailSent'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('auth.callbackFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface/90 p-8">
        <h1 className="text-2xl font-medium tracking-tight">{t('auth.forgotTitle')}</h1>
        <p className="mt-2 text-sm text-muted">{t('auth.forgotSubtitle')}</p>
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
