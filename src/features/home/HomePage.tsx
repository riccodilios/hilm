import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowRight, Sparkles } from 'lucide-react'
import { getDashboardData, homeKeys } from '@/features/home/api'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, HealthBadge, PriorityBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProjectBadge } from '@/components/ProjectBadge'
import { formatRelative } from '@/lib/utils'

export function HomePage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useQuery({
    queryKey: homeKeys.dashboard(),
    queryFn: getDashboardData,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
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
    <div>
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

      <section className="mb-8 rounded-2xl border border-border bg-gradient-to-br from-surface via-surface to-surface-2 p-6 sm:p-8">
        {data.focus ? (
          <>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">{t('home.focusNow')}</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight sm:text-3xl">{data.focus.title}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PriorityBadge priority={data.focus.priority} />
              {data.focus.projects ? <ProjectBadge {...data.focus.projects} /> : null}
              <Badge className="bg-surface-3 text-muted capitalize">
                {data.focus.status.replace('_', ' ')}
              </Badge>
              {data.focus.due_at ? (
                <span className="text-sm text-muted">
                  {t('tasks.due')} {format(new Date(data.focus.due_at), 'MMM d, h:mm a')}
                </span>
              ) : null}
            </div>
            <div className="mt-6">
              <Button asChild>
                <Link to={`/app/tasks/${data.focus.id}`}>
                  {t('home.openTask')} <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">{t('home.focusNow')}</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight">{t('home.inboxZero')}</h2>
            <div className="mt-6 flex gap-2">
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

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t('home.statOpen'), value: data.stats.openCount },
          { label: t('home.statOverdue'), value: data.stats.overdueCount },
          { label: t('home.statDone'), value: data.stats.doneThisWeek },
          { label: t('home.statProjects'), value: data.stats.projectCount },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border-subtle bg-surface/60 px-4 py-3">
            <p className="text-xs text-muted">{stat.label}</p>
            <p className="mt-1 text-2xl font-medium tabular-nums">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('home.todayOverdue')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...data.overdueTasks, ...data.todayTasks].slice(0, 8).map((task) => (
              <Link
                key={task.id}
                to={`/app/tasks/${task.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{task.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">{task.projects ? <ProjectBadge {...task.projects} /> : null}<span>{task.due_at ? format(new Date(task.due_at), 'MMM d') : t('home.noDueDate')}</span></div>
                </div>
                <PriorityBadge priority={task.priority} />
              </Link>
            ))}
            {data.overdueTasks.length + data.todayTasks.length === 0 ? (
              <p className="text-sm text-muted">{t('home.nothingDue')}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('home.upcoming')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.upcoming.slice(0, 8).map((task) => (
              <Link
                key={task.id}
                to={`/app/tasks/${task.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
              >
                <div className="min-w-0"><p className="truncate text-sm">{task.title}</p>{task.projects ? <ProjectBadge {...task.projects} className="mt-1" /> : null}</div>
                <span className="shrink-0 text-xs text-muted">
                  {task.due_at ? format(new Date(task.due_at), 'MMM d') : ''}
                </span>
              </Link>
            ))}
            {data.upcoming.length === 0 ? (
              <p className="text-sm text-muted">{t('home.noUpcoming')}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('home.projectHealth')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.projects.slice(0, 6).map((project) => (
              <Link
                key={project.id}
                to={`/app/projects/${project.id}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: project.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{project.name}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full bg-accent/80"
                      style={{ width: `${project.completion_pct}%` }}
                    />
                  </div>
                </div>
                <HealthBadge health={project.health} />
              </Link>
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

        <Card>
          <CardHeader>
            <CardTitle>{t('home.recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.activity.map((event) => (
              <div key={event.id} className="flex gap-3">
                <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-fg" />
                <div className="min-w-0">
                  <p className="text-sm">{event.summary}</p>
                  <p className="text-xs text-muted">{formatRelative(event.created_at)}</p>
                </div>
              </div>
            ))}
            {data.activity.length === 0 ? (
              <p className="text-sm text-muted">{t('home.noActivity')}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('home.dailyLog')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.dailyLog ? (
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-muted">{t('home.workedOn')} — </span>
                  {data.dailyLog.worked_on || '—'}
                </p>
                <p>
                  <span className="text-muted">{t('home.blockers')} — </span>
                  {data.dailyLog.blockers || '—'}
                </p>
                {data.dailyLog.ai_summary ? (
                  <p className="rounded-lg bg-surface-2 p-3 text-muted">{data.dailyLog.ai_summary}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted">{t('home.noLog')}</p>
            )}
            <Button asChild variant="ghost" size="sm" className="mt-3 px-0">
              <Link to="/app/daily-log">{t('home.openDailyLog')}</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('home.recentNotes')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recentNotes.map((note) => (
              <Link
                key={note.id}
                to={`/app/notes/${note.id}`}
                className="block rounded-lg px-2 py-2 hover:bg-surface-2"
              >
                <p className="text-sm">{note.title}</p>
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
