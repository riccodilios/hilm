import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authErrorMessage, useAuth } from '@/features/auth/AuthProvider'

/** Enter the code from a Hilm verification / reset email. */
export function EmailCodeForm({
  email,
  purpose,
  onVerified,
}: {
  email: string
  purpose: 'signup' | 'recovery'
  onVerified: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { verifyEmailCode } = useAuth()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const clean = code.replace(/\s+/g, '')
  const valid = /^[0-9]{6,10}$/.test(clean)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    try {
      await verifyEmailCode(email, clean, purpose)
      await onVerified()
    } catch (err) {
      toast.error(authErrorMessage(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Label htmlFor="email-code">{t('auth.codeLabel')}</Label>
      <div className="flex gap-2">
        <Input
          id="email-code"
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={12}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9\s]/g, ''))}
          className="font-mono text-lg tracking-[0.3em]"
        />
        <Button type="submit" disabled={!valid || submitting}>
          {submitting ? t('common.loading') : t('auth.verifyCode')}
        </Button>
      </div>
      <p className="text-xs text-muted">{t('auth.codeHint')}</p>
    </form>
  )
}
