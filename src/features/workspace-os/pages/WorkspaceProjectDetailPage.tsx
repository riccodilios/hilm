import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteWorkspaceProject,
  getWorkspaceProject,
  listWorkspaceActivity,
  listWorkspaceTasks,
  updateWorkspaceProject,
  workspaceKeys,
} from '@/features/workspace-os/api'
import {
  listProjectLabels,
  listWorkspaceLabels,
  setProjectLabels,
  workspaceLabelKeys,
} from '@/features/workspace-os/labels-api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { useOrgVisibility } from '@/features/workspace-os/context/OrgVisibilityProvider'
import { memberCanSeeTask } from '@/features/workspace-os/lib/member-visibility'
import { refreshWorkspaceProjectCompletion } from '@/features/workspace-os/lib/project-health'
import { TaskAssigneeLabel } from '@/features/workspace-os/components/TaskAssigneeLabel'
import { WorkspaceTaskRefBadge } from '@/features/workspace-os/components/WorkspaceTaskRefBadge'
import { ProjectIcon, ProjectIconPicker } from '@/shared/project-icons'
import { ProjectLabelPicker } from '@/components/labels/ProjectLabelPicker'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/page'
import { HealthBadge, PriorityBadge, StatusBadge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatRelative } from '@/lib/utils'
import { PRIORITIES, PROJECT_COLORS, type Priority, type ProjectStatus } from '@/types/domain'
import { cn } from '@/lib/utils'

type Tab = 'overview' | 'tasks' | 'activity' | 'ai' | 'settings'

export function WorkspaceProjectDetailPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { projectId = '' } = useParams()
  const { workspaceId, workspace, canWritePage, role } = useWorkspace()
  const canEdit = canWritePage('projects')
  const { filterTasks } = useOrgVisibility()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [settings, setSettings] = useState({
    name: '',
    description: '',
    color: PROJECT_COLORS[0]! as string,
    icon: 'folder',
    status: 'active' as ProjectStatus,
    priority: 'medium' as Priority,
  })

  const project = useQuery({
    queryKey: workspaceKeys.project(workspaceId, projectId),
    queryFn: () => getWorkspaceProject(workspaceId, projectId),
  })
  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
  })
  const activity = useQuery({
    queryKey: workspaceKeys.activity(workspaceId),
    queryFn: () => listWorkspaceActivity(workspaceId, 80),
  })
  const labelsQuery = useQuery({
    queryKey: workspaceLabelKeys.all(workspaceId),
    queryFn: () => listWorkspaceLabels(workspaceId),
  })
  const projectLabelsQuery = useQuery({
    queryKey: workspaceLabelKeys.project(workspaceId, projectId),
    queryFn: () => listProjectLabels(workspaceId, projectId),
    enabled: Boolean(projectId),
  })

  useEffect(() => {
    if (!projectId || !workspaceId) return
    void refreshWorkspaceProjectCompletion(workspaceId, projectId).then(() => {
      void qc.invalidateQueries({ queryKey: workspaceKeys.project(workspaceId, projectId) })
      void qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) })
      void qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) })
    })
  }, [projectId, workspaceId, qc])

  useEffect(() => {
    if (projectLabelsQuery.data) {
      setLabelIds(projectLabelsQuery.data.map((label) => label.id))
    }
  }, [projectLabelsQuery.data])

  useEffect(() => {
    if (!project.data) return
    setSettings({
      name: project.data.name,
      description: project.data.description ?? '',
      color: project.data.color || PROJECT_COLORS[0]!,
      icon: project.data.icon || 'folder',
      status: project.data.status,
      priority: project.data.priority,
    })
  }, [project.data])

  const projectTasks = useMemo(() => {
    const scoped = filterTasks((tasks.data ?? []).filter((task) => task.project_id === projectId))
    return scoped.filter((task) => memberCanSeeTask(task, user?.id, role))
  }, [tasks.data, projectId, filterTasks, user?.id, role])

  const openTasks = projectTasks.filter((task) => task.status !== 'done' && task.status !== 'archived')
  const doneTasks = projectTasks.filter((task) => task.status === 'done')
  const completionPct = project.data?.completion_pct ?? 0

  const projectActivity = useMemo(() => {
    return (activity.data ?? []).filter((event) => {
      if (event.entity_type === 'project' && event.entity_id === projectId) return true
      if (event.entity_type === 'task') {
        return projectTasks.some((task) => task.id === event.entity_id)
      }
      return false
    })
  }, [activity.data, projectId, projectTasks])

  const remove = useMutation({
    mutationFn: () => deleteWorkspaceProject(workspaceId, projectId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) })
      toast.success(t('workspace.projectDeleted'))
      window.location.assign(`/workspace/${workspaceId}/projects`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const save = useMutation({
    mutationFn: () =>
      updateWorkspaceProject(workspaceId, projectId, {
        name: settings.name.trim(),
        description: settings.description.trim() || null,
        color: settings.color,
        icon: settings.icon,
        status: settings.status,
        priority: settings.priority,
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: workspaceKeys.project(workspaceId, projectId) }),
        qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) }),
        qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) }),
      ])
      toast.success(t('workspace.projectSaved'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const saveLabels = useMutation({
    mutationFn: (ids: string[]) => setProjectLabels(workspaceId, projectId, ids),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceLabelKeys.all(workspaceId) })
      toast.success('Labels updated')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (project.isLoading) return <Skeleton className="h-40" />
  if (!project.data) return <p className="text-sm text-danger">{t('common.notFound')}</p>

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-background"
            style={{ backgroundColor: project.data.color || '#60a5fa' }}
          >
            <ProjectIcon icon={project.data.icon} size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-medium tracking-tight sm:text-3xl">
              {project.data.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <PriorityBadge priority={project.data.priority} />
              <span className="text-xs capitalize text-muted">{project.data.status}</span>
            </div>
            {project.data.description ? (
              <p className="mt-2 text-sm text-muted">{project.data.description}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <HealthBadge health={project.data.health} />
          <span className="text-sm tabular-nums text-muted">{Math.round(completionPct)}%</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">{t('workspace.projectOverview')}</TabsTrigger>
          <TabsTrigger value="tasks">{t('nav.tasks')}</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="ai">{t('nav.ai')}</TabsTrigger>
          <TabsTrigger value="settings">{t('workspace.projectSettings')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-foreground/80 transition-all"
                    style={{ width: `${Math.min(100, completionPct)}%` }}
                  />
                </div>
                <div className="flex justify-between text-sm text-muted">
                  <span>{doneTasks.length} completed</span>
                  <span>{openTasks.length} open</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Health</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted">
                  {project.data.health_explanation || 'Health updates as tasks move.'}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base">Labels</CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectLabelPicker
                labels={labelsQuery.data ?? []}
                selectedIds={labelIds}
                disabled={!canEdit || saveLabels.isPending}
                onChange={(ids) => {
                  setLabelIds(ids)
                  if (canEdit) saveLabels.mutate(ids)
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="mt-6 space-y-2">
          <div className="flex gap-2">
            {canWritePage('tasks') ? (
              <Button asChild variant="secondary" size="sm">
                <Link to={`/workspace/${workspaceId}/tasks?project=${projectId}&new=1`}>
                  <Plus className="size-4" /> {t('workspace.newTask')}
                </Link>
              </Button>
            ) : null}
          </div>
          {projectTasks.map((task) => (
            <Link
              key={task.id}
              to={`/workspace/${workspaceId}/tasks/${task.id}`}
              className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface/40 px-4 py-3 text-sm transition-colors hover:bg-surface"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <WorkspaceTaskRefBadge
                    workspaceId={workspaceId}
                    taskKey={workspace.task_key}
                    taskNumber={task.task_number}
                    taskId={task.id}
                    link={false}
                  />
                  <span className={cn('truncate font-medium', task.status === 'done' && 'text-muted line-through')}>
                    {task.title}
                  </span>
                </div>
                <TaskAssigneeLabel
                  assignee={task.assignee}
                  assignment={task.assignment}
                  compact
                  className="shrink-0"
                />
              </div>
            </Link>
          ))}
          {!projectTasks.length ? <p className="text-sm text-muted">{t('workspace.noTasks')}</p> : null}
        </TabsContent>

        <TabsContent value="activity" className="mt-6 space-y-2">
          {projectActivity.map((event) => (
            <div
              key={event.id}
              className="rounded-xl border border-border-subtle bg-surface/40 px-4 py-3 text-sm"
            >
              <p>{event.summary}</p>
              <p className="mt-1 text-xs text-muted">{formatRelative(event.created_at)}</p>
            </div>
          ))}
          {!projectActivity.length ? (
            <p className="text-sm text-muted">No activity for this project yet.</p>
          ) : null}
        </TabsContent>

        <TabsContent value="ai" className="mt-6">
          <Card className="max-w-lg">
            <CardContent className="space-y-3 pt-5">
              <p className="text-sm text-muted">
                Ask Hilm AI with this project in context — create tasks, summarize progress, or plan next steps.
              </p>
              <Button asChild>
                <Link to={`/workspace/${workspaceId}/ai?projectId=${projectId}`}>
                  <ExternalLink className="size-4" /> Open AI with project context
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <Card className="max-w-2xl">
            <CardContent className="space-y-4 pt-5">
              <div className="space-y-2">
                <Label htmlFor="ws-project-settings-name">{t('workspace.name')}</Label>
                <Input
                  id="ws-project-settings-name"
                  value={settings.name}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setSettings((value) => ({ ...value, name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ws-project-settings-desc">{t('workspace.description')}</Label>
                <Textarea
                  id="ws-project-settings-desc"
                  value={settings.description}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setSettings((value) => ({ ...value, description: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ws-project-status">Status</Label>
                  <select
                    id="ws-project-status"
                    disabled={!canEdit}
                    value={settings.status}
                    onChange={(e) =>
                      setSettings((value) => ({
                        ...value,
                        status: e.target.value as ProjectStatus,
                      }))
                    }
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="on_hold">On hold</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ws-project-priority">Priority</Label>
                  <select
                    id="ws-project-priority"
                    disabled={!canEdit}
                    value={settings.priority}
                    onChange={(e) =>
                      setSettings((value) => ({
                        ...value,
                        priority: e.target.value as Priority,
                      }))
                    }
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('workspace.icon')}</Label>
                <ProjectIconPicker
                  value={settings.icon}
                  color={settings.color}
                  onChange={(icon) => {
                    if (!canEdit) return
                    setSettings((value) => ({ ...value, icon }))
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('workspace.color')}</Label>
                <div className="flex flex-wrap gap-2">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      disabled={!canEdit}
                      aria-label={color}
                      onClick={() => setSettings((value) => ({ ...value, color }))}
                      className="size-8 rounded-full border-2"
                      style={{
                        backgroundColor: color,
                        borderColor: settings.color === color ? 'var(--foreground)' : 'transparent',
                      }}
                    />
                  ))}
                </div>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => save.mutate()}
                    disabled={!settings.name.trim() || save.isPending}
                  >
                    {t('common.save')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted">{t('workspace.readOnlySettings')}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
