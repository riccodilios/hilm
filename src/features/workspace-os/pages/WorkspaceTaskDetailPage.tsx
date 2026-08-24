import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  deleteWorkspaceTask,
  getWorkspaceTask,
  listAssignmentEvents,
  listWorkspaceProjects,
  updateWorkspaceTask,
  workspaceKeys,
} from '@/features/workspace-os/api'
import {
  downloadWorkspaceTaskAttachment,
  listWorkspaceTaskAttachments,
  removeWorkspaceTaskAttachment,
  uploadWorkspaceTaskAttachment,
} from '@/features/workspace-os/attachments-api'
import {
  TaskAssignmentFields,
  type TaskAssignmentValue,
} from '@/features/workspace-os/components/TaskAssignmentFields'
import { TaskAssigneeLabel } from '@/features/workspace-os/components/TaskAssigneeLabel'
import { WorkspaceTaskComments } from '@/features/workspace-os/components/WorkspaceTaskComments'
import { WorkspaceTaskRefBadge } from '@/features/workspace-os/components/WorkspaceTaskRefBadge'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { formatWorkspaceTaskRef } from '@/features/workspace-os/lib/task-refs'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { AttachmentPanel } from '@/components/attachments/AttachmentPanel'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PageHeader, Skeleton } from '@/components/ui/page'

export function WorkspaceTaskDetailPage() {
  const { t } = useTranslation()
  const { taskId = '' } = useParams()
  const { workspaceId, workspace, canEdit } = useWorkspace()
  const qc = useQueryClient()
  const [description, setDescription] = useState('')
  const [assignment, setAssignment] = useState<TaskAssignmentValue>({
    departmentId: null,
    teamId: null,
    assigneeId: null,
  })
  const task = useQuery({
    queryKey: workspaceKeys.task(workspaceId, taskId),
    queryFn: () => getWorkspaceTask(workspaceId, taskId),
  })
  const projects = useQuery({
    queryKey: workspaceKeys.projects(workspaceId),
    queryFn: () => listWorkspaceProjects(workspaceId),
  })
  const resolvedTaskId = task.data?.id ?? taskId
  const attachments = useQuery({
    queryKey: [...workspaceKeys.task(workspaceId, resolvedTaskId), 'attachments'],
    queryFn: () => listWorkspaceTaskAttachments(workspaceId, resolvedTaskId),
    enabled: Boolean(task.data?.id),
  })
  const assignmentHistory = useQuery({
    queryKey: [...workspaceKeys.task(workspaceId, resolvedTaskId), 'assignment-events'],
    queryFn: () => listAssignmentEvents(workspaceId, resolvedTaskId),
    enabled: Boolean(task.data?.id),
  })

  useEffect(() => {
    if (task.data) {
      setDescription(task.data.description ?? '')
      setAssignment({
        departmentId: task.data.department_id ?? null,
        teamId: task.data.team_id ?? null,
        assigneeId: task.data.assignee_id ?? null,
      })
    }
  }, [
    task.data?.id,
    task.data?.description,
    task.data?.department_id,
    task.data?.team_id,
    task.data?.assignee_id,
  ])

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateWorkspaceTask>[2]) =>
      updateWorkspaceTask(workspaceId, resolvedTaskId, patch),
    onSuccess: async (_data, patch) => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.task(workspaceId, taskId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) })
      await qc.invalidateQueries({
        queryKey: [...workspaceKeys.task(workspaceId, resolvedTaskId), 'assignment-events'],
      })
      toast.success(
        patch.project_id !== undefined ? t('tasks.movedProject') : t('workspace.taskUpdated'),
      )
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: () => deleteWorkspaceTask(workspaceId, resolvedTaskId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      toast.success(t('workspace.taskDeleted'))
      window.location.assign(`/workspace/${workspaceId}/tasks`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (task.isLoading) return <Skeleton className="h-40" />
  if (!task.data) return <p className="text-sm text-danger">{t('common.notFound')}</p>

  const shortRef = formatWorkspaceTaskRef(workspace.task_key, task.data.task_number)

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title={task.data.title}
        description={`${task.data.workspace_projects?.name ?? '—'} · ${task.data.status}`}
      />
      {shortRef ? (
        <WorkspaceTaskRefBadge
          workspaceId={workspaceId}
          taskKey={workspace.task_key}
          taskNumber={task.data.task_number}
          taskId={task.data.id}
          link={false}
          className="text-xs"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{t('workspace.assignedTo')}</span>
        <TaskAssigneeLabel assignee={task.data.assignee} assignment={task.data.assignment} />
      </div>
      {canEdit ? (
        <div className="space-y-2">
          <Label htmlFor="workspace-task-project">{t('tasks.project')}</Label>
          <select
            id="workspace-task-project"
            value={task.data.project_id ?? ''}
            disabled={save.isPending || !(projects.data?.length)}
            onChange={(event) => {
              const nextProjectId = event.target.value
              if (!nextProjectId || nextProjectId === task.data?.project_id) return
              save.mutate({ project_id: nextProjectId })
            }}
            className="h-10 w-full max-w-md rounded-lg border border-border bg-surface px-3 text-sm"
          >
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
            {task.data.project_id &&
            !(projects.data ?? []).some((project) => project.id === task.data?.project_id) ? (
              <option value={task.data.project_id}>
                {task.data.workspace_projects?.name ?? t('tasks.currentProject')}
              </option>
            ) : null}
          </select>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label>{t('projects.desc')}</Label>
        <RichTextEditor
          value={description}
          editable={canEdit}
          onChange={setDescription}
          onBlur={(html) => {
            if (!canEdit) return
            if (html === (task.data?.description ?? '')) return
            save.mutate({ description: html })
          }}
        />
      </div>
      {canEdit ? (
        <TaskAssignmentFields
          workspaceId={workspaceId}
          value={assignment}
          onChange={setAssignment}
          priority={task.data.priority}
          titleHint={task.data.title}
          dueAt={task.data.due_at}
          estimatedHours={task.data.estimated_hours}
        />
      ) : null}
      {canEdit ? (
        <Button
          variant="secondary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              department_id: assignment.departmentId,
              team_id: assignment.teamId,
              assignee_id: assignment.assigneeId,
            })
          }
        >
          {t('workspace.saveAssignment')}
        </Button>
      ) : null}
      {(assignmentHistory.data?.length ?? 0) > 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface/40 p-4">
          <p className="mb-2 text-sm font-medium">{t('workspace.assignmentHistory')}</p>
          <ul className="space-y-2 text-xs text-muted">
            {assignmentHistory.data!.map((event) => (
              <li key={event.id} className="border-b border-border-subtle pb-2 last:border-0">
                <p className="text-foreground">{event.summary}</p>
                <p className="mt-0.5">
                  {new Date(event.created_at).toLocaleString()} · {event.event_type}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <AttachmentPanel
        items={attachments.data ?? []}
        onUpload={async (files) => {
          for (const file of Array.from(files)) {
            await uploadWorkspaceTaskAttachment(workspaceId, resolvedTaskId, file)
          }
          await qc.invalidateQueries({
            queryKey: [...workspaceKeys.task(workspaceId, resolvedTaskId), 'attachments'],
          })
        }}
        onRemove={async (id) => {
          await removeWorkspaceTaskAttachment(id)
          await qc.invalidateQueries({
            queryKey: [...workspaceKeys.task(workspaceId, resolvedTaskId), 'attachments'],
          })
        }}
        onDownload={(item) =>
          downloadWorkspaceTaskAttachment(
            item as Awaited<ReturnType<typeof listWorkspaceTaskAttachments>>[number],
          )
        }
      />
      <WorkspaceTaskComments
        workspaceId={workspaceId}
        taskId={task.data.id}
        canEdit={canEdit}
      />
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => save.mutate({ status: 'todo' })}>
            Todo
          </Button>
          <Button variant="secondary" onClick={() => save.mutate({ status: 'in_progress' })}>
            In progress
          </Button>
          <Button onClick={() => save.mutate({ status: 'done' })}>{t('common.complete')}</Button>
          <Button variant="ghost" onClick={() => remove.mutate()}>
            {t('common.delete')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
