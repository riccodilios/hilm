import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Eye, Send, TestTube2 } from 'lucide-react'
import { getBroadcastAdmin, submitBroadcast, type BroadcastContent } from '@/features/settings/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type Locale = 'en' | 'ar'
type Audience = 'all' | 'en' | 'ar'
const EMPTY: BroadcastContent = { subject: '', preheader: '', heading: '', body: '', ctaLabel: '', ctaUrl: '' }

function filled(c: BroadcastContent) {
  return Boolean(c.subject.trim() && c.heading.trim() && c.body.trim())
}

function clean(c: BroadcastContent): BroadcastContent {
  const out: BroadcastContent = { subject: c.subject.trim(), heading: c.heading.trim(), body: c.body.trim() }
  if (c.preheader?.trim()) out.preheader = c.preheader.trim()
  if (c.ctaLabel?.trim() && c.ctaUrl?.trim()) {
    out.ctaLabel = c.ctaLabel.trim()
    out.ctaUrl = c.ctaUrl.trim()
  }
  return out
}

/** Admin-only composer for product news emails (server enforces HILM_ADMIN_EMAILS). */
export function EmailBroadcastPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const info = useQuery({ queryKey: ['email-broadcast-admin'], queryFn: getBroadcastAdmin, retry: false })
  const [locale, setLocale] = useState<Locale>('en')
  const [audience, setAudience] = useState<Audience>('all')
  const [content, setContent] = useState<Record<Locale, BroadcastContent>>({ en: { ...EMPTY }, ar: { ...EMPTY } })
  const [preview, setPreview] = useState<Partial<Record<Locale, string>>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)

  const payloadContent = () => {
    const out: Partial<Record<Locale, BroadcastContent>> = {}
    for (const l of ['en', 'ar'] as const) if (filled(content[l])) out[l] = clean(content[l])
    return out
  }
  const ready = Object.keys(payloadContent()).length > 0 && (audience === 'all' || filled(content[audience]))
  const errorText = (error: Error & { code?: string }) =>
    t(`broadcast.errors.${error.code}`, { defaultValue: t('broadcast.errors.generic') })

  const previewMutation = useMutation({
    mutationFn: () => submitBroadcast({ action: 'preview', audience, content: payloadContent() }),
    onSuccess: (res) => setPreview(res.html ?? {}),
    onError: (e: Error) => toast.error(errorText(e)),
  })
  const testMutation = useMutation({
    mutationFn: () => submitBroadcast({ action: 'test', audience, content: payloadContent() }),
    onSuccess: () => toast.success(t('broadcast.testSent')),
    onError: (e: Error) => toast.error(errorText(e)),
  })
  const sendMutation = useMutation({
    mutationFn: () => submitBroadcast({ action: 'send', audience, content: payloadContent(), confirm: 'SEND' }),
    onSuccess: async (res) => {
      setConfirmOpen(false)
      toast.success(t('broadcast.queued', { count: res.queued ?? 0 }))
      await qc.invalidateQueries({ queryKey: ['email-broadcast-admin'] })
    },
    onError: (e: Error) => toast.error(errorText(e)),
  })

  if (info.isLoading) return <Skeleton className="h-64" />
  if (!info.data?.admin) {
    return (
      <div>
        <PageHeader title={t('broadcast.title')} />
        <p className="mt-6 text-sm text-muted">{t('broadcast.notAdmin')}</p>
      </div>
    )
  }
  const data = info.data
  const current = content[locale]
  const set = (field: keyof BroadcastContent) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setContent((prev) => ({ ...prev, [locale]: { ...prev[locale], [field]: e.target.value } }))
  const recipients = data.audience[audience]

  return (
    <div className="space-y-6">
      <PageHeader title={t('broadcast.title')} description={t('broadcast.description')} />
      {!data.sendingEnabled ? (
        <p className="rounded-xl border border-border-subtle bg-surface-2/40 px-4 py-3 text-sm text-muted">
          {t('broadcast.notConfigured')}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('broadcast.compose')}</CardTitle>
          <CardDescription>{t('broadcast.composeDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="inline-flex rounded-xl border border-border bg-surface-2/60 p-1" role="tablist">
            {(['en', 'ar'] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={locale === l}
                onClick={() => setLocale(l)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium',
                  locale === l ? 'bg-surface text-foreground shadow-sm' : 'text-muted',
                )}
              >
                {l === 'en' ? 'English' : 'العربية'}
                {filled(content[l]) ? ' ✓' : ''}
              </button>
            ))}
          </div>
          <div dir={locale === 'ar' ? 'rtl' : 'ltr'} className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bc-subject">{t('broadcast.subject')}</Label>
              <Input id="bc-subject" maxLength={150} value={current.subject} onChange={set('subject')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-preheader">{t('broadcast.preheader')}</Label>
              <Input id="bc-preheader" maxLength={150} value={current.preheader} onChange={set('preheader')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-heading">{t('broadcast.heading')}</Label>
              <Input id="bc-heading" maxLength={160} value={current.heading} onChange={set('heading')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-body">{t('broadcast.body')}</Label>
              <Textarea id="bc-body" rows={8} maxLength={8000} value={current.body} onChange={set('body')} />
              <p className="text-xs text-muted">{t('broadcast.bodyHint')}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bc-cta-label">{t('broadcast.ctaLabel')}</Label>
                <Input id="bc-cta-label" maxLength={40} value={current.ctaLabel} onChange={set('ctaLabel')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bc-cta-url">{t('broadcast.ctaUrl')}</Label>
                <Input
                  id="bc-cta-url"
                  dir="ltr"
                  placeholder="https://hilm.tech/features"
                  value={current.ctaUrl}
                  onChange={set('ctaUrl')}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
            <Label htmlFor="bc-audience" className="text-sm">
              {t('broadcast.audience')}
            </Label>
            <select
              id="bc-audience"
              className="h-9 rounded-lg border border-border bg-surface px-3 text-sm"
              value={audience}
              onChange={(e) => setAudience(e.target.value as Audience)}
            >
              <option value="all">{t('broadcast.audienceAll', { count: data.audience.all })}</option>
              <option value="en">{t('broadcast.audienceEn', { count: data.audience.en })}</option>
              <option value="ar">{t('broadcast.audienceAr', { count: data.audience.ar })}</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!ready || previewMutation.isPending} onClick={() => previewMutation.mutate()}>
              <Eye className="size-4" /> {t('broadcast.preview')}
            </Button>
            <Button
              variant="secondary"
              disabled={!ready || !data.sendingEnabled || testMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              <TestTube2 className="size-4" /> {t('broadcast.sendTest')}
            </Button>
            <Button disabled={!ready || !data.sendingEnabled || !recipients} onClick={() => setConfirmOpen(true)}>
              <Send className="size-4" /> {t('broadcast.sendAll', { count: recipients })}
            </Button>
          </div>
        </CardContent>
      </Card>

      {Object.keys(preview).length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {(['en', 'ar'] as const).map((l) =>
            preview[l] ? (
              <iframe
                key={l}
                title={`preview-${l}`}
                sandbox=""
                srcDoc={preview[l]}
                className="h-[640px] w-full rounded-2xl border border-border-subtle bg-black"
              />
            ) : null,
          )}
        </div>
      ) : null}

      {data.recent.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('broadcast.recent')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.recent.map((b) => (
              <div key={b.id} className="flex flex-wrap justify-between gap-2 border-b border-border-subtle pb-2 last:border-0">
                <span className="font-medium">{b.subject}</span>
                <span className="text-muted">
                  {new Date(b.created_at).toLocaleString()} · {b.audience} · {t('broadcast.recipients', { count: b.recipients })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('broadcast.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('broadcast.confirmBody', { count: recipients })}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={sendMutation.isPending} onClick={() => sendMutation.mutate()}>
              {sendMutation.isPending ? t('common.loading') : t('broadcast.confirmSend')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
