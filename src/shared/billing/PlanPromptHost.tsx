import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  bestOwnedWorkspacePlan,
  billingKeys,
  getMyBilling,
  getPlanCatalog,
  getWorkspaceUsage,
  personalPlanId,
  requestPlanUpgrade,
  sar,
  type PlanInfo,
} from '@/shared/billing/api'
import { onPlanPrompt, type PlanPromptDetail } from '@/shared/billing/plan-prompt'
import { recommendPlan, type PlanId, type WorkspacePlanId } from '@/shared/billing/recommend'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

function formatBytes(bytes: number | null) {
  if (!bytes) return '—'
  return bytes >= 1024 ** 3 ? `${Math.round(bytes / 1024 ** 3)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

function PlanGains({ plan }: { plan: PlanInfo }) {
  const { t, i18n } = useTranslation()
  const n = (value: number) => new Intl.NumberFormat(i18n.language).format(value)
  const items =
    plan.scope === 'personal'
      ? [
          t('billing.gainsList.requestsDay', { n: n(plan.requests_per_day) }),
          t('billing.gainsList.tokensDay', { n: n(plan.tokens_per_day) }),
          t('billing.gainsList.meetingMinutes', { n: n(plan.meeting_minutes_per_month) }),
        ]
      : [
          t('billing.gainsList.workspaces', { count: plan.max_workspaces ?? 1 }),
          t('billing.gainsList.projects', { n: plan.max_projects_per_workspace ?? 10 }),
          t('billing.gainsList.requestsDay', { n: n(plan.requests_per_day) }),
          t('billing.gainsList.tokensMonth', { n: n(plan.tokens_per_month) }),
          t('billing.gainsList.meetingMinutes', { n: n(plan.meeting_minutes_per_month) }),
          t('billing.gainsList.storage', { size: formatBytes(plan.storage_quota_bytes) }),
          t('billing.gainsList.pooled'),
          t('billing.gainsList.members'),
        ]
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Check className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function PlanBox({ label, plan, planId }: { label: string; plan: PlanInfo | null; planId: PlanId | null }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-border-subtle bg-surface/60 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 truncate font-medium">{planId ? t(`billing.plans.${planId}`) : t('billing.noPlan')}</p>
      <p className="text-xs text-muted">
        {plan ? (plan.price_sar_monthly > 0 ? t('billing.perMonth', { price: sar(plan.price_sar_monthly, i18n.language) }) : t('billing.free')) : '—'}
      </p>
    </div>
  )
}

export function PlanPromptHost() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [detail, setDetail] = useState<PlanPromptDetail | null>(null)

  useEffect(() => onPlanPrompt(setDetail), [])

  const open = Boolean(detail && user)
  const catalog = useQuery({ queryKey: billingKeys.catalog(), queryFn: getPlanCatalog, enabled: open, staleTime: 10 * 60_000 })
  const billing = useQuery({ queryKey: billingKeys.me(), queryFn: getMyBilling, enabled: open })
  const workspaceId = detail?.workspaceId ?? null
  const usage = useQuery({
    queryKey: billingKeys.workspace(workspaceId ?? 'none'),
    queryFn: () => getWorkspaceUsage(workspaceId!),
    enabled: open && Boolean(workspaceId),
  })

  const reason = detail?.reason ?? 'personal_upgrade'
  const workspacePlan: WorkspacePlanId | null =
    reason === 'workspace_create'
      ? bestOwnedWorkspacePlan(billing.data)
      : ((detail?.workspacePlan ?? (usage.data?.plan?.id as WorkspacePlanId | undefined)) ?? null)
  const rec = recommendPlan({
    reason,
    personalPlan: personalPlanId(billing.data),
    workspacePlan,
    isBillingOwner: detail?.isBillingOwner ?? usage.data?.is_billing_owner ?? false,
  })
  const planById = (id: PlanId | null) => (id ? (catalog.data ?? []).find((p) => p.id === id) ?? null : null)
  const target = planById(rec.target)
  const current = planById(rec.current)
  const pending = Boolean(rec.target && billing.data?.pending_requests.some((r) => r.plan_id === rec.target))

  const request = useMutation({
    mutationFn: () => requestPlanUpgrade(rec.target as Exclude<PlanId, 'free'>, rec.scope === 'workspace' ? workspaceId : null),
    onSuccess: async () => {
      toast.success(t('billing.requested'))
      await qc.invalidateQueries({ queryKey: billingKeys.all })
      setDetail(null)
    },
    onError: () => toast.error(t('billing.requestFailed')),
  })

  const loading = catalog.isLoading || billing.isLoading || (Boolean(workspaceId) && usage.isLoading)
  const pool = usage.data?.ai_pool
  const plan = usage.data?.plan
  const n = (value: number) => new Intl.NumberFormat(i18n.language).format(value)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setDetail(null)}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(`billing.prompt.${reason}.title`)}</DialogTitle>
          <DialogDescription>{t(`billing.prompt.${reason}.body`)}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-6">
            <LoaderCircle className="size-5 animate-spin text-muted" />
          </div>
        ) : (
          <div className="space-y-4">
            {reason === 'workspace_ai_limit' && pool && plan ? (
              <div className="rounded-xl border border-border-subtle bg-surface/60 p-3 text-sm">
                <p className="font-medium">{t('billing.usageStatus')}</p>
                <p className="mt-1 text-muted">{t('billing.usageToday', { used: n(pool.tokens_day), limit: n(Number(plan.tokens_per_day)) })}</p>
                <p className="text-muted">{t('billing.usageMonth', { used: n(pool.tokens_month), limit: n(Number(plan.tokens_per_month)) })}</p>
              </div>
            ) : null}

            {rec.target ? (
              <>
                <div className="flex items-stretch gap-2">
                  <PlanBox label={t('billing.current')} plan={current} planId={rec.current} />
                  <ArrowRight className="mt-6 size-4 shrink-0 text-muted rtl:rotate-180" />
                  <PlanBox label={t('billing.required')} plan={target} planId={rec.target} />
                </div>
                {target ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t('billing.gains')}</p>
                    <PlanGains plan={target} />
                  </div>
                ) : null}
                <div className="space-y-1 text-xs text-muted">
                  <p>{t('billing.dataSafe')}</p>
                  <p>{t('billing.separate')}</p>
                  <p>{t('billing.paymentNote')}</p>
                </div>
              </>
            ) : null}

            {rec.note ? <p className="rounded-xl bg-surface-2/60 px-3 py-2 text-sm">{t(`billing.notes.${rec.note}`)}</p> : null}

            <div className="flex flex-wrap justify-end gap-2">
              {workspaceId && rec.scope === 'workspace' ? (
                <Button asChild variant="ghost">
                  <Link to={`/workspace/${workspaceId}/settings`} onClick={() => setDetail(null)}>
                    {t('billing.openSettings')}
                  </Link>
                </Button>
              ) : null}
              <Button variant={rec.target ? 'ghost' : 'secondary'} onClick={() => setDetail(null)}>
                {t('billing.close')}
              </Button>
              {rec.target ? (
                <Button disabled={pending || request.isPending} onClick={() => request.mutate()}>
                  {request.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {pending ? t('billing.requestPending') : t('billing.request', { plan: t(`billing.plans.${rec.target}`) })}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
