import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format, parseISO } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, LoaderCircle, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  dailyLogKeys,
  generateDailyLog,
  getDailyLog,
  getDailyLogStats,
  type DailyLogStats,
} from '@/features/daily-log/api'
import { homeKeys } from '@/features/home/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { cn, todayISO } from '@/lib/utils'

function shiftDate(date: string, days: number) {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd')
}

function MetricBar({
  label,
  value,
  max,
  tone = 'default',
}: {
  label: string
  value: number
  max: number
  tone?: 'default' | 'accent' | 'warn'
}) {
  const width = max > 0 ? Math.max(value > 0 ? 8 : 0, Math.round((value / max) * 100)) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-foreground">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            tone === 'accent' && 'bg-accent',
            tone === 'warn' && 'bg-amber-500/80',
            tone === 'default' && 'bg-foreground/70',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

function ActivityMix({ stats }: { stats: DailyLogStats }) {
  const { t } = useTranslation()
  const entries = (
    [
      ['task', stats.byEntity.task],
      ['note', stats.byEntity.note],
      ['project', stats.byEntity.project],
      ['ai', stats.byEntity.ai],
      ['idea', stats.byEntity.idea],
    ] as const
  ).filter(([, value]) => value > 0)

  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  if (!total) {
    return <p className="text-sm text-muted">{t('dailyLog.noActivity')}</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className={cn(
              'h-full',
              key === 'task' && 'bg-foreground/75',
              key === 'note' && 'bg-sky-500/70',
              key === 'project' && 'bg-emerald-500/70',
              key === 'ai' && 'bg-accent',
              key === 'idea' && 'bg-amber-500/70',
            )}
            style={{ width: `${(value / total) * 100}%` }}
            title={`${t(`dailyLog.entity.${key}`)}: ${value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {entries.map(([key, value]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                'size-1.5 rounded-full',
                key === 'task' && 'bg-foreground/75',
                key === 'note' && 'bg-sky-500/70',
                key === 'project' && 'bg-emerald-500/70',
                key === 'ai' && 'bg-accent',
                key === 'idea' && 'bg-amber-500/70',
              )}
            />
            {t(`dailyLog.entity.${key}`)} · {value}
          </span>
        ))}
      </div>
    </div>
  )
}

function Section({ title, body }: { title: string; body?: string | null }) {
  if (!body?.trim()) return null
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{title}</h3>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{body}</p>
    </section>
  )
}

export function DailyLogPage() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [date, setDate] = useState(todayISO())
  const autoTriedRef = useRef<string | null>(null)
  const dateLocale = i18n.language.startsWith('ar') ? ar : enUS
  const isToday = date === todayISO()
  const prettyDate = useMemo(
    () => format(parseISO(date), 'EEEE, MMM d', { locale: dateLocale }),
    [date, dateLocale],
  )

  const logQuery = useQuery({
    queryKey: dailyLogKeys.byDate(date),
    queryFn: () => getDailyLog(date),
  })
  const statsQuery = useQuery({
    queryKey: dailyLogKeys.stats(date),
    queryFn: () => getDailyLogStats(date),
  })

  const generate = useMutation({
    mutationFn: () =>
      generateDailyLog({
        logDate: date,
        locale: i18n.language.startsWith('ar') ? 'ar' : 'en',
      }),
    onSuccess: async (result) => {
      qc.setQueryData(dailyLogKeys.byDate(date), result.log)
      qc.setQueryData(dailyLogKeys.stats(date), result.stats)
      await Promise.all([
        qc.invalidateQueries({ queryKey: dailyLogKeys.all }),
        qc.invalidateQueries({ queryKey: homeKeys.all }),
      ])
      toast.success(t('dailyLog.generated'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  useEffect(() => {
    if (logQuery.isLoading || generate.isPending) return
    if (logQuery.data?.ai_summary) return
    if (autoTriedRef.current === date) return
    autoTriedRef.current = date
    generate.mutate()
    // Auto-generate once per date when Hilm has not written a log yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, logQuery.data?.ai_summary, logQuery.isLoading, generate.isPending])

  const stats = statsQuery.data
  const log = logQuery.data
  const flowMax = Math.max(stats?.completed ?? 0, stats?.created ?? 0, stats?.openDue ?? 0, 1)
  const busy =
    logQuery.isLoading || statsQuery.isLoading || generate.isPending

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t('dailyLog.title')}
        description={t('dailyLog.description')}
        actions={
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            variant={log?.ai_summary ? 'secondary' : 'default'}
          >
            {generate.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {log?.ai_summary ? t('dailyLog.regenerate') : t('dailyLog.generate')}
          </Button>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <Button
          size="icon"
          variant="secondary"
          aria-label={t('dailyLog.prevDay')}
          onClick={() => setDate((current) => shiftDate(current, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-medium">{prettyDate}</p>
          <p className="text-xs text-muted">{isToday ? t('dailyLog.today') : date}</p>
        </div>
        <Button
          size="icon"
          variant="secondary"
          aria-label={t('dailyLog.nextDay')}
          disabled={isToday}
          onClick={() => setDate((current) => shiftDate(current, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {busy && !log?.ai_summary ? (
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted">{t('dailyLog.statCompleted')}</p>
                <p className="mt-1 text-2xl font-medium tabular-nums">{stats?.completed ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted">{t('dailyLog.statCreated')}</p>
                <p className="mt-1 text-2xl font-medium tabular-nums">{stats?.created ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted">{t('dailyLog.statOpenDue')}</p>
                <p className="mt-1 text-2xl font-medium tabular-nums">{stats?.openDue ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="space-y-5 p-5">
              <div>
                <h2 className="text-sm font-medium">{t('dailyLog.flowTitle')}</h2>
                <p className="mt-1 text-xs text-muted">{t('dailyLog.flowDesc')}</p>
              </div>
              <div className="space-y-3">
                <MetricBar
                  label={t('dailyLog.statCompleted')}
                  value={stats?.completed ?? 0}
                  max={flowMax}
                  tone="accent"
                />
                <MetricBar
                  label={t('dailyLog.statCreated')}
                  value={stats?.created ?? 0}
                  max={flowMax}
                />
                <MetricBar
                  label={t('dailyLog.statOpenDue')}
                  value={stats?.openDue ?? 0}
                  max={flowMax}
                  tone="warn"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-sm font-medium">{t('dailyLog.mixTitle')}</h2>
                <p className="mt-1 text-xs text-muted">{t('dailyLog.mixDesc')}</p>
              </div>
              {stats ? <ActivityMix stats={stats} /> : <Skeleton className="h-10" />}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-6 p-5 sm:p-6">
              {log?.ai_summary ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-accent">
                    <Sparkles className="size-4" />
                    <p className="text-xs font-medium uppercase tracking-[0.14em]">
                      {t('dailyLog.aiSummary')}
                    </p>
                  </div>
                  <p className="text-base leading-relaxed text-foreground">{log.ai_summary}</p>
                  {log.hours != null ? (
                    <p className="text-xs text-muted">
                      {t('dailyLog.hoursEstimate', { hours: log.hours })}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <Sparkles className="mx-auto mb-3 size-8 text-muted" />
                  <p className="font-medium">{t('dailyLog.emptyTitle')}</p>
                  <p className="mt-2 text-sm text-muted">{t('dailyLog.emptyBody')}</p>
                </div>
              )}

              <div className="space-y-5 border-t border-border-subtle pt-5">
                <Section title={t('dailyLog.workedOn')} body={log?.worked_on} />
                <Section title={t('dailyLog.wins')} body={log?.wins} />
                <Section title={t('dailyLog.blockers')} body={log?.blockers} />
                <Section title={t('dailyLog.tomorrow')} body={log?.tomorrow} />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
