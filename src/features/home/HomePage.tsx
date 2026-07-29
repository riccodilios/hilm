import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowRight, Check, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getDashboardData, homeKeys } from '@/features/home/api'
import { updateTask, tasksKeys } from '@/features/tasks/api'
import { activityKeys } from '@/features/activity/api'
import { ProjectInsightCard } from '@/features/projects/ProjectInsightCard'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, PriorityBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProjectBadge } from '@/components/ProjectBadge'
import { formatDueRemaining } from '@/lib/dates'
import { formatRelative } from '@/lib/utils'
import type { TaskWithProject } from '@/features/tasks/reminders'

function DueTaskRow({ task, locale }: { task: TaskWithProject; locale: string }) {
  return (
    <Link
      to={`/app/tasks/${task.id}`}
      className="flex w-full min-w-0 items-start justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        {task.projects ? <ProjectBadge {...task.projects} /> : null}
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className="truncate text-xs text-muted">
          {formatDueRemaining(task, { locale }) || '—'}
        </p>
      </div>
      <PriorityBadge priority={task.priority} />
    </Link>
  )
}

export function HomePage() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const locale = i18n.language
  const { data, isLoading, error } = useQuery({
    queryKey: homeKeys.dashboard(),
    queryFn: getDashboardData,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })

  const completeFocus = useMutation({
    mutationFn: (taskId: string) => updateTask(taskId, { status: 'done' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: homeKeys.all }),
        qc.invalidateQueries({ queryKey: tasksKeys.all }),
        qc.invalidateQueries({ queryKey: activityKeys.all }),
      ])
      toast.success(t('home.focusCompleted'))
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading) {
    return (
      <div className="w-full min-w-0 space-y-4">
        <Skeleton className="h-10 w-48 max-w-full" />
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <PageHeader
        title={t('home.title')}
        description={error instanceof Error ? error.message : t('home.loadError')}
      />
    )
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-full">
      <PageHeader
        title={t('home.title')}
        description={format(new Date(), 'EEEE, MMMM d')}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link to="/app/ai">
              <Sparkles className="size-4" />
              {t('home.askAi')}
            </Link>
          </Button>
        }
      />

      <section className="mb-8 w-full min-w-0 rounded-2xl border border-border bg-gradient-to-br from-surface via-surface to-surface-2 p-5 sm:p-8">
        {data.focus ? (
          <>
            <p className="text-xs uppercase tracking-[0.16em] text-muted">{t('home.focusNow')}</p>
            <h2 className="mt-3 break-words text-2xl font-medium tracking-tight sm:text-3xl">
              {data.focus.title}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PriorityBadge priority={data.focus.priority} />
              {data.focus.projects ? <ProjectBadge {...data.focus.projects} /> : null}
              <Badge className="bg-surface-3 text-muted capitalize">
                {data.focus.status.replace('_', ' ')}
              </Badge>
              {data.focus.due_at || data.focus.due_date ? (
                <span className="text-sm text-muted">
                  {formatDueRemaining(data.focus, { locale })}
                </span>
              ) : null}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild>
                <Link to={`/app/tasks/${data.focus.id}`}>
                  {t('home.openTask')} <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={completeFocus.isPending}
                onClick={() => completeFocus.mutate(data.focus!.id)}
              >
                <Check className="size-4" />
                {t('home.markDone')}
              </Button>
              <Button asChild variant="ghost">
                <Link to="/app/mission-control">{t('mission.title')}</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs uppercase tracking-[0.16em] text-muted">{t('home.focusNow')}</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight">{t('home.inboxZero')}</h2>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/app/tasks?new=1">{t('home.newTask')}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/app/ai">{t('home.askChief')}</Link>
              </Button>
            </div>
          </>
        )}
      </section>

      <div className="mb-6 grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t('home.statOpen'), value: data.stats.openCount },
          { label: t('home.statOverdue'), value: data.stats.overdueCount },
          { label: t('home.statDone'), value: data.stats.doneThisWeek },
          { label: t('home.statProjects'), value: data.stats.projectCount },
        ].map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 rounded-xl border border-border-subtle bg-surface/60 px-3 py-3 sm:px-4"
          >
            <p className="truncate text-xs text-muted">{stat.label}</p>
            <p className="mt-1 text-2xl font-medium tabular-nums">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid w-full min-w-0 gap-4 lg:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>{t('home.dueToday')}</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 space-y-1">
            {data.overdueTasks.length ? (
              <div className="mb-3 space-y-1 border-b border-border-subtle pb-3">
                <p className="px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-danger">
                  {t('home.overdue')}
                </p>
                {data.overdueTasks.slice(0, 4).map((task) => (
                  <DueTaskRow key={task.id} task={task} locale={locale} />
                ))}
              </div>
            ) : null}
            {data.todayTasks.map((task) => (
              <DueTaskRow key={task.id} task={task} locale={locale} />
            ))}
            {data.todayTasks.length === 0 && data.overdueTasks.length === 0 ? (
              <p className="px-2 text-sm text-muted">{t('home.nothingDueToday')}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>{t('home.upcoming')}</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 space-y-1">
            {data.upcoming.slice(0, 8).map((task) => (
              <DueTaskRow key={task.id} task={task} locale={locale} />
            ))}
            {data.upcoming.length === 0 ? (
              <p className="px-2 text-sm text-muted">{t('home.noUpcoming')}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden lg:col-span-2">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>{t('home.projectHealth')}</CardTitle>
            <Button asChild variant="ghost" size="sm" className="self-start sm:self-auto">
              <Link to="/app/projects">{t('home.viewProjects')}</Link>
            </Button>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-3 sm:grid-cols-2">
            {data.projects.slice(0, 6).map((project) => (
              <ProjectInsightCard key={project.id} project={project} />
            ))}
            {data.projects.length === 0 ? (
              <p className="text-sm text-muted">
                {t('home.noProjects')}{' '}
                <Link to="/app/projects" className="underline">
                  {t('home.createOne')}
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>{t('home.recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 space-y-3">
            {data.activity.map((event) => (
              <div key={event.id} className="flex min-w-0 gap-3">
                <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-fg" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm">{event.summary}</p>
                  <p className="text-xs text-muted">{formatRelative(event.created_at)}</p>
                </div>
              </div>
            ))}
            {data.activity.length === 0 ? (
              <p className="text-sm text-muted">{t('home.noActivity')}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>{t('home.dailyLog')}</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            {data.dailyLog ? (
              <div className="space-y-2 text-sm">
                {data.dailyLog.ai_summary ? (
                  <p className="break-words rounded-lg bg-surface-2 p-3 text-muted">
                    {data.dailyLog.ai_summary}
                  </p>
                ) : (
                  <>
                    <p className="break-words">
                      <span className="text-muted">{t('home.workedOn')} — </span>
                      {data.dailyLog.worked_on || '—'}
                    </p>
                    <p className="break-words">
                      <span className="text-muted">{t('home.blockers')} — </span>
                      {data.dailyLog.blockers || '—'}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">{t('home.noLog')}</p>
            )}
            <Button asChild variant="ghost" size="sm" className="mt-3 px-0">
              <Link to="/app/daily-log">{t('home.openDailyLog')}</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('home.recentNotes')}</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 space-y-2">
            {data.recentNotes.map((note) => (
              <Link
                key={note.id}
                to={`/app/notes/${note.id}`}
                className="block min-w-0 rounded-lg px-2 py-2 hover:bg-surface-2"
              >
                <p className="truncate text-sm">{note.title}</p>
                <p className="text-xs text-muted">{formatRelative(note.updated_at)}</p>
              </Link>
            ))}
            {data.recentNotes.length === 0 ? (
              <p className="text-sm text-muted">{t('home.noNotes')}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
