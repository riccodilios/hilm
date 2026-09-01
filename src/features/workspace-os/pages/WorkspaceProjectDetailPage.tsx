import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  deleteWorkspaceProject,
  getWorkspaceProject,
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
import { TaskAssigneeLabel } from '@/features/workspace-os/components/TaskAssigneeLabel'
import { ProjectIcon, ProjectIconPicker } from '@/shared/project-icons'
import { ProjectLabelPicker } from '@/components/labels/ProjectLabelPicker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/page'
import { HealthBadge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PROJECT_COLORS } from '@/types/domain'

type Tab = 'overview' | 'settings'

export function WorkspaceProjectDetailPage() {
  const { t } = useTranslation()
  const { projectId = '' } = useParams()
  const { workspaceId, canEdit } = useWorkspace()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [settings, setSettings] = useState({
    name: '',
    description: '',
    color: PROJECT_COLORS[0]! as string,
    icon: 'folder',
  })

  const project = useQuery({
    queryKey: workspaceKeys.project(workspaceId, projectId),
    queryFn: () => getWorkspaceProject(workspaceId, projectId),
  })
  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
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
    })
  }, [project.data])

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

  const projectTasks = (tasks.data ?? []).filter((task) => task.project_id === projectId)

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
            {project.data.description ? (
              <p className="mt-1 text-sm text-muted">{project.data.description}</p>
            ) : null}
          </div>
        </div>
        <HealthBadge health={project.data.health} />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="overview">{t('workspace.projectOverview')}</TabsTrigger>
          <TabsTrigger value="settings">{t('workspace.projectSettings')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <Link to={`/workspace/${workspaceId}/tasks?project=${projectId}`}>{t('nav.tasks')}</Link>
            </Button>
          </div>

          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base">Labels</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label className="sr-only">Project labels</Label>
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

          <div className="space-y-2">
            {projectTasks.map((task) => (
              <Link
                key={task.id}
                to={`/workspace/${workspaceId}/tasks/${task.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface/40 px-4 py-3 text-sm hover:bg-surface"
              >
                <span className="min-w-0 truncate font-medium">{task.title}</span>
                <TaskAssigneeLabel
                  assignee={task.assignee}
                  assignment={task.assignment}
                  compact
                  className="shrink-0"
                />
              </Link>
            ))}
            {!projectTasks.length ? <p className="text-sm text-muted">{t('workspace.noTasks')}</p> : null}
          </div>
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
