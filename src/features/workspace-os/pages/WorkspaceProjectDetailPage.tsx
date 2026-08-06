import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  deleteWorkspaceProject,
  getWorkspaceProject,
  listWorkspaceTasks,
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
import { ProjectLabelPicker } from '@/components/labels/ProjectLabelPicker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { PageHeader, Skeleton } from '@/components/ui/page'

export function WorkspaceProjectDetailPage() {
  const { t } = useTranslation()
  const { projectId = '' } = useParams()
  const { workspaceId, canEdit } = useWorkspace()
  const qc = useQueryClient()
  const [labelIds, setLabelIds] = useState<string[]>([])

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

  const remove = useMutation({
    mutationFn: () => deleteWorkspaceProject(workspaceId, projectId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) })
      toast.success(t('workspace.projectDeleted'))
      window.location.assign(`/workspace/${workspaceId}/projects`)
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
      <PageHeader title={project.data.name} description={project.data.description || undefined} />
      <div className="mt-4 flex gap-2">
        <Button asChild variant="secondary">
          <Link to={`/workspace/${workspaceId}/tasks?project=${projectId}`}>{t('nav.tasks')}</Link>
        </Button>
        {canEdit ? (
          <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t('common.delete')}
          </Button>
        ) : null}
      </div>

      <Card className="mt-6 max-w-xl">
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

      <div className="mt-6 space-y-2">
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
    </div>
  )
}
