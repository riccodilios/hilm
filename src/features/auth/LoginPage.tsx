import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/AuthProvider'
import { isSupabaseConfigured } from '@/lib/supabase/client'

export function LoginPage() {
  const { signIn, user, loading } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to="/app" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isSupabaseConfigured()) {
      toast.error(t('auth.missingEnv'))
      return
    }
    setSubmitting(true)
    try {
      await signIn(email, password)
      toast.success(t('auth.welcomeBack'))
      navigate('/app')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('auth.signInTitle'))
    } finally {
      setSubmitting(false)
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
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? t('auth.signingIn') : t('common.signIn')}
          </Button>
          <Link to="/auth/forgot-password" className="block text-center text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">
            Forgot password?
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
