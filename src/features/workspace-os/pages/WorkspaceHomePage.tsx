import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import { motion } from 'framer-motion'
import { ArrowRight, Check, Plus, Sparkles, Users } from 'lucide-react'
import { toast } from 'sonner'
import {
  getWorkspaceHome,
  updateWorkspaceTask,
  workspaceKeys,
  type WorkspaceTask,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import {
  memberInitials,
  resolveMemberDisplayName,
} from '@/features/workspace-os/lib/member-display'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, HealthBadge, PriorityBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDueRemaining } from '@/lib/dates'
import { cn, formatRelative } from '@/lib/utils'

function DueTaskRow({
  task,
  workspaceId,
  locale,
}: {
  task: WorkspaceTask
  workspaceId: string
  locale: string
}) {
  return (
    <Link
      to={`/workspace/${workspaceId}/tasks/${task.id}`}
      className="flex w-full min-w-0 items-start justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        {task.workspace_projects ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: task.workspace_projects.color }}
            />
            {task.workspace_projects.name}
          </span>
        ) : null}
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className="truncate text-xs text-muted">
          {formatDueRemaining(task, { locale }) || '—'}
        </p>
      </div>
      <PriorityBadge priority={task.priority} />
    </Link>
  )
}

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.04 * i, duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
  }),
}

export function WorkspaceHomePage() {
  const { t, i18n } = useTranslation()
  const { workspaceId, workspace, canEdit } = useWorkspace()
  const qc = useQueryClient()
  const locale = i18n.language
  const dateLocale = locale.startsWith('ar') ? ar : enUS

  const home = useQuery({
    queryKey: workspaceKeys.home(workspaceId),
    queryFn: () => getWorkspaceHome(workspaceId),
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const completeFocus = useMutation({
    mutationFn: (taskId: string) =>
      updateWorkspaceTask(workspaceId, taskId, { status: 'done' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) }),
        qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) }),
        qc.invalidateQueries({ queryKey: workspaceKeys.activity(workspaceId) }),
      ])
      toast.success(t('workspace.focusCompleted'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (home.isLoading) {
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

  if (home.isError || !home.data) {
    return (
      <PageHeader
        title={workspace.name}
        description={home.error instanceof Error ? home.error.message : t('workspace.homeDesc')}
      />
    )
  }

  const data = home.data
  const focus = data.focus

  return (
    <div className="mx-auto w-full min-w-0 max-w-full">
      <PageHeader
        title={workspace.name}
        description={format(new Date(), 'EEEE, MMMM d', { locale: dateLocale })}
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <Button asChild size="sm">
                <Link to={`/workspace/${workspaceId}/tasks?new=1`}>
                  <Plus className="size-4" />
                  {t('workspace.newTask')}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary" size="sm">
              <Link to={`/workspace/${workspaceId}/ai`}>
                <Sparkles className="size-4" />
                {t('workspace.askAi')}
              </Link>
            </Button>
          </div>
        }
      />

      <motion.section
        custom={0}
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="mb-8 w-full min-w-0 rounded-2xl border border-border bg-gradient-to-br from-surface via-surface to-surface-2 p-5 sm:p-8"
      >
        {focus ? (
          <>
            <p className="text-xs uppercase tracking-[0.16em] text-muted">{t('workspace.focusNow')}</p>
            <h2 className="mt-3 break-words text-2xl font-medium tracking-tight sm:text-3xl">
              {focus.title}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PriorityBadge priority={focus.priority} />
              {focus.workspace_projects ? (
                <Badge className="bg-surface-3 text-muted">
                  <span
                    className="me-1.5 inline-block size-1.5 rounded-full"
                    style={{ backgroundColor: focus.workspace_projects.color }}
                  />
                  {focus.workspace_projects.name}
                </Badge>
              ) : null}
              <Badge className="bg-surface-3 text-muted capitalize">
                {focus.status.replace('_', ' ')}
              </Badge>
              {focus.due_at || focus.due_date ? (
                <span className="text-sm text-muted">
                  {formatDueRemaining(focus, { locale })}
                </span>
              ) : null}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild>
                <Link to={`/workspace/${workspaceId}/tasks/${focus.id}`}>
                  {t('workspace.openTask')} <ArrowRight className="size-4" />
                </Link>
              </Button>
              {canEdit ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={completeFocus.isPending}
                  onClick={() => completeFocus.mutate(focus.id)}
                >
                  <Check className="size-4" />
                  {t('workspace.markDone')}
                </Button>
              ) : null}
              <Button asChild variant="ghost">
                <Link to={`/workspace/${workspaceId}/team`}>
                  <Users className="size-4" />
                  {t('nav.team')}
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs uppercase tracking-[0.16em] text-muted">{t('workspace.focusNow')}</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight">{t('workspace.inboxZero')}</h2>
            <p className="mt-2 max-w-md text-sm text-muted">
              {workspace.description || t('workspace.homeDesc')}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {canEdit ? (
                <Button asChild>
                  <Link to={`/workspace/${workspaceId}/tasks?new=1`}>{t('workspace.newTask')}</Link>
                </Button>
              ) : null}
              <Button asChild variant="secondary">
                <Link to={`/workspace/${workspaceId}/ai`}>{t('workspace.askAi')}</Link>
              </Button>
            </div>
          </>
        )}
      </motion.section>

      <motion.div
        custom={1}
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="mb-6 grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {[
          { label: t('workspace.openTasks'), value: data.openTaskCount },
          { label: t('workspace.statOverdue'), value: data.overdueCount },
          { label: t('workspace.doneTasks'), value: data.doneTaskCount },
          { label: t('nav.projects'), value: data.projectCount },
        ].map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 rounded-xl border border-border-subtle bg-surface/60 px-3 py-3 sm:px-4"
          >
            <p className="truncate text-xs text-muted">{stat.label}</p>
            <p className="mt-1 text-2xl font-medium tabular-nums">{stat.value}</p>
          </div>
        ))}
      </motion.div>

      <div className="grid w-full min-w-0 gap-4 lg:grid-cols-2">
        <motion.div custom={2} variants={fadeUp} initial="hidden" animate="show">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader>
              <CardTitle>{t('workspace.dueToday')}</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 space-y-1">
              {data.overdueTasks.length ? (
                <div className="mb-3 space-y-1 border-b border-border-subtle pb-3">
                  <p className="px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-danger">
                    {t('workspace.overdue')}
                  </p>
                  {data.overdueTasks.map((task) => (
                    <DueTaskRow
                      key={task.id}
                      task={task}
                      workspaceId={workspaceId}
                      locale={locale}
                    />
                  ))}
                </div>
              ) : null}
              {data.todayTasks.map((task) => (
                <DueTaskRow key={task.id} task={task} workspaceId={workspaceId} locale={locale} />
              ))}
              {data.todayTasks.length === 0 && data.overdueTasks.length === 0 ? (
                <p className="px-2 text-sm text-muted">{t('workspace.nothingDueToday')}</p>
              ) : null}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={3} variants={fadeUp} initial="hidden" animate="show">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader>
              <CardTitle>{t('workspace.upcoming')}</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 space-y-1">
              {data.upcoming.map((task) => (
                <DueTaskRow key={task.id} task={task} workspaceId={workspaceId} locale={locale} />
              ))}
              {data.upcoming.length === 0 ? (
                <p className="px-2 text-sm text-muted">{t('workspace.noUpcoming')}</p>
              ) : null}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={4} variants={fadeUp} initial="hidden" animate="show" className="lg:col-span-2">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{t('workspace.projectHealth')}</CardTitle>
              <Button asChild variant="ghost" size="sm" className="self-start sm:self-auto">
                <Link to={`/workspace/${workspaceId}/projects`}>{t('workspace.viewProjects')}</Link>
              </Button>
            </CardHeader>
            <CardContent className="grid min-w-0 gap-3 sm:grid-cols-2">
              {data.projects.map((project) => (
                <Link
                  key={project.id}
                  to={`/workspace/${workspaceId}/projects/${project.id}`}
                  className="flex w-full min-w-0 gap-3 rounded-xl border border-border-subtle bg-surface/60 p-3 transition-colors hover:border-border hover:bg-surface"
                >
                  <div className="relative flex size-11 shrink-0 items-center justify-center">
                    <svg width={44} height={44} className="-rotate-90" aria-hidden>
                      <circle
                        cx={22}
                        cy={22}
                        r={18}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3.5}
                        className="text-surface-3"
                      />
                      <circle
                        cx={22}
                        cy={22}
                        r={18}
                        fill="none"
                        stroke={project.color || '#60a5fa'}
                        strokeWidth={3.5}
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 18}
                        strokeDashoffset={
                          2 * Math.PI * 18 -
                          (Math.max(0, Math.min(100, project.completion_pct)) / 100) *
                            2 *
                            Math.PI *
                            18
                        }
                      />
                    </svg>
                    <span className="absolute text-[10px] font-medium tabular-nums">
                      {Math.round(project.completion_pct)}%
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{project.name}</p>
                      <HealthBadge health={project.health} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                      <span>
                        {project.remainingTasks} {t('workspace.tasksRemaining')}
                      </span>
                      {project.overdueCount > 0 ? (
                        <span className="text-danger">
                          {project.overdueCount} {t('workspace.overdueShort')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              ))}
              {!data.projects.length ? (
                <p className="text-sm text-muted">
                  {t('workspace.noProjects')}{' '}
                  {canEdit ? (
                    <Link to={`/workspace/${workspaceId}/projects`} className="underline">
                      {t('workspace.createOne')}
                    </Link>
                  ) : null}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={5} variants={fadeUp} initial="hidden" animate="show">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t('workspace.recentActivity')}</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link to={`/workspace/${workspaceId}/activity`}>{t('common.viewAll')}</Link>
              </Button>
            </CardHeader>
            <CardContent className="min-w-0 space-y-3">
              {data.recentActivity.map((event) => (
                <div key={event.id} className="flex min-w-0 gap-3">
                  <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-fg" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{event.summary}</p>
                    <p className="text-xs text-muted">{formatRelative(event.created_at)}</p>
                  </div>
                </div>
              ))}
              {!data.recentActivity.length ? (
                <p className="text-sm text-muted">{t('workspace.noActivity')}</p>
              ) : null}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={6} variants={fadeUp} initial="hidden" animate="show">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t('nav.team')}</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link to={`/workspace/${workspaceId}/team`}>{t('common.viewAll')}</Link>
              </Button>
            </CardHeader>
            <CardContent className="min-w-0 space-y-2">
              {data.members.map((member) => {
                const name = resolveMemberDisplayName({
                  displayNameOverride: member.display_name_override,
                  displayName: member.profiles?.display_name,
                  email: member.email ?? member.profiles?.email,
                })
                return (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-3 rounded-lg px-2 py-2"
                  >
                    {member.profiles?.avatar_url ? (
                      <img
                        src={member.profiles.avatar_url}
                        alt=""
                        className="size-8 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="flex size-8 items-center justify-center rounded-lg bg-accent/15 text-[10px] font-medium text-accent">
                        {memberInitials(name)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className={cn('text-xs capitalize text-muted')}>
                        {t(`workspace.roles.${member.role}`, { defaultValue: member.role })}
                      </p>
                    </div>
                  </div>
                )
              })}
              {!data.members.length ? (
                <p className="text-sm text-muted">{t('workspace.noMembers')}</p>
              ) : null}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
