import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/lib/supabase/client'
import { createWorkspaceTask, listWorkspaceMembers, workspaceKeys } from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { buildActionTaskDescription } from '@/shared/meetings/format'
import { createTaskOnce } from '@/shared/meetings/task-dedupe'
import type { LinkedTask, MeetingMember, MeetingTaskBridge, MeetingsAdapter } from '@/shared/meetings'

async function findTaskForActionItem(workspaceId: string, actionItemId: string) {
  const { data, error } = await supabase
    .from('workspace_tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('source_action_item_id', actionItemId)
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

export function useWorkspaceMeetingsAdapter(
  project: { id: string; name: string } | null | undefined,
): MeetingsAdapter | null {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { workspaceId, workspace, canEdit, canManage, canWritePage } = useWorkspace()
  const canWriteProjects = canEdit && canWritePage('projects')
  const canWriteTasks = canEdit && canWritePage('tasks')

  const membersQuery = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => listWorkspaceMembers(workspaceId),
    enabled: Boolean(workspaceId),
  })

  return useMemo(() => {
    if (!project || !user || !workspaceId) return null
    const members: MeetingMember[] = (membersQuery.data ?? []).map((member) => ({
      id: member.user_id,
      name: member.display_name_override || member.profiles?.display_name || member.email || member.user_id.slice(0, 8),
    }))
    const memberIds = new Set(members.map((member) => member.id))

    const tasks: MeetingTaskBridge = {
      async createTaskFromActionItem({ meeting, item, ownerName, ownerUserId }) {
        if (!canWriteTasks) throw new Error(t('meetings.errors.noTaskPermission'))
        return createTaskOnce({
          findExisting: () => findTaskForActionItem(workspaceId, item.id),
          create: async () => {
            const task = await createWorkspaceTask(workspaceId, {
              projectId: project.id,
              title: item.title,
              description: buildActionTaskDescription({ item, meeting, ownerName, t }),
              priority: item.priority ?? 'none',
              dueDate: item.dueDate,
              assigneeId:
                ownerUserId && memberIds.has(ownerUserId) && item.ownerCertainty === 'confirmed' ? ownerUserId : null,
              sourceMeetingId: meeting.id,
              sourceActionItemId: item.id,
            })
            return task.id
          },
        })
      },
      async listTasksForMeeting(meetingId) {
        const { data, error } = await supabase
          .from('workspace_tasks')
          .select('id, title, status, source_action_item_id')
          .eq('workspace_id', workspaceId)
          .eq('source_meeting_id', meetingId)
          .order('created_at')
        if (error) throw error
        return (data ?? []).map(
          (row): LinkedTask => ({
            id: row.id,
            title: row.title,
            status: row.status,
            sourceActionItemId: row.source_action_item_id,
          }),
        )
      },
      taskHref: (taskId) => `/workspace/${workspaceId}/tasks/${taskId}`,
      invalidateKeys: [workspaceKeys.tasks(workspaceId), workspaceKeys.home(workspaceId)],
    }

    const self = members.find((member) => member.id === user.id)
    return {
      scope: { os: 'workspace', userId: user.id, projectId: project.id, workspaceId },
      projectName: project.name,
      canEdit: canWriteProjects,
      canDelete: (meeting) => meeting.createdBy === user.id || canManage,
      meetingHref: (meetingId) => `/workspace/${workspaceId}/projects/${project.id}/meetings/${meetingId}`,
      listHref: `/workspace/${workspaceId}/projects/${project.id}?tab=meetings`,
      tasks,
      members,
      userDisplayName: self?.name ?? user.email ?? 'Hilm',
      workspaceName: workspace?.name ?? null,
    }
  }, [project, user, workspaceId, workspace?.name, membersQuery.data, canWriteProjects, canWriteTasks, canManage, t])
}
