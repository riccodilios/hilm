import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  deleteWorkspaceTask,
  getWorkspaceTask,
  listWorkspaceMembers,
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
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { AttachmentPanel } from '@/components/attachments/AttachmentPanel'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PageHeader, Skeleton } from '@/components/ui/page'

export function WorkspaceTaskDetailPage() {
  const { t } = useTranslation()
  const { taskId = '' } = useParams()
  const { workspaceId, canEdit } = useWorkspace()
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
  const attachments = useQuery({
    queryKey: [...workspaceKeys.task(workspaceId, taskId), 'attachments'],
    queryFn: () => listWorkspaceTaskAttachments(workspaceId, taskId),
    enabled: Boolean(taskId),
  })
  const members = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => listWorkspaceMembers(workspaceId),
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
  }, [task.data?.id, task.data?.description, task.data?.department_id, task.data?.team_id, task.data?.assignee_id])

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateWorkspaceTask>[2]) =>
      updateWorkspaceTask(workspaceId, taskId, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.task(workspaceId, taskId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      toast.success(t('workspace.taskUpdated'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: () => deleteWorkspaceTask(workspaceId, taskId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      toast.success(t('workspace.taskDeleted'))
      window.location.assign(`/workspace/${workspaceId}/tasks`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (task.isLoading) return <Skeleton className="h-40" />
  if (!task.data) return <p className="text-sm text-danger">{t('common.notFound')}</p>

  const mentionOptions =
    members.data?.map((m) => ({
      id: m.user_id,
      label:
        m.display_name_override ||
        m.profiles?.display_name ||
        m.email ||
        m.user_id.slice(0, 8),
    })) ?? []

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title={task.data.title}
        description={`${task.data.workspace_projects?.name ?? '—'} · ${task.data.status}`}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{t('workspace.assignedTo')}</span>
        <TaskAssigneeLabel assignee={task.data.assignee} />
      </div>
      <div className="space-y-2">
        <Label>{t('projects.desc')}</Label>
        <RichTextEditor
          value={description}
          editable={canEdit}
          mentions={mentionOptions}
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
      <AttachmentPanel
        items={attachments.data ?? []}
        onUpload={async (files) => {
          for (const file of Array.from(files)) {
            await uploadWorkspaceTaskAttachment(workspaceId, taskId, file)
          }
          await qc.invalidateQueries({
            queryKey: [...workspaceKeys.task(workspaceId, taskId), 'attachments'],
          })
        }}
        onRemove={async (id) => {
          await removeWorkspaceTaskAttachment(id)
          await qc.invalidateQueries({
            queryKey: [...workspaceKeys.task(workspaceId, taskId), 'attachments'],
          })
        }}
        onDownload={(item) =>
          downloadWorkspaceTaskAttachment(
            item as Awaited<ReturnType<typeof listWorkspaceTaskAttachments>>[number],
          )
        }
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
