import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowRight, Sparkles } from 'lucide-react'
import { getDashboardData, homeKeys } from '@/features/home/api'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, HealthBadge, PriorityBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRelative } from '@/lib/utils'

export function HomePage() {
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
        title="Today"
        description={error instanceof Error ? error.message : 'Could not load dashboard'}
      />
    )
  }

  return (
    <div>
      <PageHeader
        title="What should I work on today?"
        description={format(new Date(), 'EEEE, MMMM d')}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link to="/app/ai">
              <Sparkles className="size-4" />
              Ask AI
            </Link>
          </Button>
        }
      />

      <section className="mb-8 rounded-2xl border border-border bg-gradient-to-br from-surface via-surface to-surface-2 p-6 sm:p-8">
        {data.focus ? (
          <>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Focus now</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight sm:text-3xl">{data.focus.title}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PriorityBadge priority={data.focus.priority} />
              <Badge className="bg-surface-3 text-muted capitalize">
                {data.focus.status.replace('_', ' ')}
              </Badge>
              {data.focus.due_at ? (
                <span className="text-sm text-muted">
                  Due {format(new Date(data.focus.due_at), 'MMM d, h:mm a')}
                </span>
              ) : null}
            </div>
            <div className="mt-6">
              <Button asChild>
                <Link to={`/app/tasks/${data.focus.id}`}>
                  Open task <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Focus now</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight">Inbox zero — create a task or ask AI what to do next.</h2>
            <div className="mt-6 flex gap-2">
              <Button asChild>
                <Link to="/app/tasks?new=1">New task</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/app/ai">Ask Chief of Staff</Link>
              </Button>
            </div>
          </>
        )}
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Open', value: data.stats.openCount },
          { label: 'Overdue', value: data.stats.overdueCount },
          { label: 'Done / 7d', value: data.stats.doneThisWeek },
          { label: 'Projects', value: data.stats.projectCount },
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
            <CardTitle>Today & overdue</CardTitle>
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
                  <p className="text-xs text-muted">
                    {task.due_at ? format(new Date(task.due_at), 'MMM d') : 'No due date'}
                  </p>
                </div>
                <PriorityBadge priority={task.priority} />
              </Link>
            ))}
            {data.overdueTasks.length + data.todayTasks.length === 0 ? (
              <p className="text-sm text-muted">Nothing due today.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming deadlines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.upcoming.slice(0, 8).map((task) => (
              <Link
                key={task.id}
                to={`/app/tasks/${task.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
              >
                <p className="truncate text-sm">{task.title}</p>
                <span className="shrink-0 text-xs text-muted">
                  {task.due_at ? format(new Date(task.due_at), 'MMM d') : ''}
                </span>
              </Link>
            ))}
            {data.upcoming.length === 0 ? (
              <p className="text-sm text-muted">No deadlines in the next 7 days.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Project health</CardTitle>
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
                No projects yet.{' '}
                <Link to="/app/projects" className="underline">
                  Create one
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
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
              <p className="text-sm text-muted">Activity will appear as you work.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daily log</CardTitle>
          </CardHeader>
          <CardContent>
            {data.dailyLog ? (
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-muted">Worked on — </span>
                  {data.dailyLog.worked_on || '—'}
                </p>
                <p>
                  <span className="text-muted">Blockers — </span>
                  {data.dailyLog.blockers || '—'}
                </p>
                {data.dailyLog.ai_summary ? (
                  <p className="rounded-lg bg-surface-2 p-3 text-muted">{data.dailyLog.ai_summary}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted">No log for today yet.</p>
            )}
            <Button asChild variant="ghost" size="sm" className="mt-3 px-0">
              <Link to="/app/daily-log">Open daily log</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent notes</CardTitle>
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
              <p className="text-sm text-muted">Notes will show up here.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
