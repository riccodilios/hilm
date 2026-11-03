import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/page'
import { billingKeys, getMyBilling, sar } from '@/shared/billing/api'
import { openPlanPrompt } from '@/shared/billing/plan-prompt'

/** Personal plan plus the workspace plans this person pays for, kept visibly separate. */
export function PersonalPlanCard() {
  const { t, i18n } = useTranslation()
  const billing = useQuery({ queryKey: billingKeys.me(), queryFn: getMyBilling })
  const data = billing.data
  const price = (amount: number) => (amount > 0 ? t('billing.perMonth', { price: sar(amount, i18n.language) }) : t('billing.free'))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('billing.settings.title')}</CardTitle>
        <CardDescription>{t('billing.settings.personalDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {billing.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : data ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface-2/40 p-3">
              <div className="min-w-0">
                <p className="text-xs text-muted">{t('billing.planScope.personal')}</p>
                <p className="font-medium">{t(`billing.plans.${data.personal.id}`)}</p>
                <p className="text-xs text-muted">{price(data.personal.price_sar_monthly)}</p>
              </div>
              {data.personal.id === 'free' ? (
                <Button size="sm" onClick={() => openPlanPrompt({ reason: 'personal_upgrade' })}>
                  {t('billing.settings.upgrade')}
                </Button>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">{t('billing.settings.workspaceTitle')}</p>
              {data.workspace_subscriptions.length ? (
                data.workspace_subscriptions.map((s) => (
                  <div key={s.id} className="rounded-2xl border border-border-subtle bg-surface-2/40 p-3 text-sm">
                    <p className="font-medium">
                      {t(`billing.plans.${s.plan.id}`)} · <span className="text-muted">{price(s.plan.price_sar_monthly)}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {t('billing.settings.used', { used: s.workspaces_used, max: s.plan.max_workspaces ?? 1 })}
                      {s.workspaces.length ? ` · ${s.workspaces.map((w) => w.name).join(', ')}` : ''}
                    </p>
                  </div>
                ))
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">{t('billing.settings.none')}</p>
                  <Button size="sm" variant="secondary" onClick={() => openPlanPrompt({ reason: 'workspace_create' })}>
                    {t('billing.settings.getTeam')}
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
