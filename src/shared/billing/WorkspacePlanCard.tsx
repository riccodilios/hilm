import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CreditCard } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { billingKeys, requestPlanUpgrade, sar, type WorkspaceUsage } from '@/shared/billing/api'
import type { WorkspacePlanId } from '@/shared/billing/recommend'
import { cn } from '@/lib/utils'

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const { i18n } = useTranslation()
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const n = (value: number) => new Intl.NumberFormat(i18n.language).format(value)
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted">{label}</span>
        <span className="shrink-0 tabular-nums">
          {n(used)} / {n(limit)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-danger' : 'bg-accent/70')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** The workspace's own subscription: plan, status, pooled allowances. Never the members' personal plans. */
export function WorkspacePlanCard({ workspaceId, usage }: { workspaceId: string; usage: WorkspaceUsage | undefined }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const plan = usage?.plan ?? null
  const status = usage?.subscription?.effective_status ?? 'none'
  const request = useMutation({
    mutationFn: (planId: WorkspacePlanId) => requestPlanUpgrade(planId, workspaceId),
    onSuccess: async () => {
      toast.success(t('billing.requested'))
      await qc.invalidateQueries({ queryKey: billingKeys.all })
    },
    onError: () => toast.error(t('billing.requestFailed')),
  })

  if (!usage?.ok) return null
  const pool = usage.ai_pool
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <CreditCard className="size-4 text-accent" />
        <div className="min-w-0">
          <CardTitle>{t('billing.workspace.title')}</CardTitle>
          <CardDescription>{usage.is_billing_owner ? t('billing.workspace.owner') : t('billing.workspace.notOwner')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{plan ? t(`billing.plans.${plan.id}`) : t('billing.noPlan')}</p>
            {plan ? <p className="text-xs text-muted">{t('billing.perMonth', { price: sar(plan.price_sar_monthly, i18n.language) })}</p> : null}
          </div>
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium',
              status === 'active' ? 'bg-success/15 text-success' : status === 'grace' ? 'bg-warning/15 text-warning' : 'bg-danger/15 text-danger',
            )}
          >
            {t(`billing.workspace.status.${status}`)}
          </span>
        </div>
        {status === 'grace' && usage.subscription?.grace_until ? (
          <p className="text-sm text-muted">
            {t('billing.workspace.graceUntil', { date: new Date(usage.subscription.grace_until).toLocaleDateString(i18n.language) })}
          </p>
        ) : null}
        {status === 'restricted' || status === 'none' ? <p className="text-sm text-muted">{t('billing.workspace.restricted')}</p> : null}

        {plan ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Meter label={t('billing.workspace.projects', { used: usage.projects, max: plan.max_projects_per_workspace ?? 10 })} used={usage.projects} limit={plan.max_projects_per_workspace ?? 10} />
            {pool ? (
              <>
                <Meter label={t('billing.workspace.aiToday')} used={pool.tokens_day} limit={Number(plan.tokens_per_day)} />
                <Meter label={t('billing.workspace.aiMonth')} used={pool.tokens_month} limit={Number(plan.tokens_per_month)} />
                <Meter label={t('workspace.settingsPage.meetingMinutes')} used={Math.round(usage.meeting_minutes_month)} limit={plan.meeting_minutes_per_month} />
              </>
            ) : null}
          </div>
        ) : null}

        {usage.is_billing_owner ? (
          <div className="flex flex-wrap gap-2">
            {plan?.id === 'team' && status === 'active' ? (
              <Button size="sm" variant="secondary" disabled={request.isPending} onClick={() => request.mutate('team_pro')}>
                {t('billing.workspace.upgradeTeamPro')}
              </Button>
            ) : null}
            {plan && (status === 'grace' || status === 'restricted') ? (
              <Button size="sm" disabled={request.isPending} onClick={() => request.mutate(plan.id as WorkspacePlanId)}>
                {t('billing.workspace.renew')}
              </Button>
            ) : null}
          </div>
        ) : null}
        <p className="text-xs text-muted">{t('billing.paymentNote')}</p>
      </CardContent>
    </Card>
  )
}
