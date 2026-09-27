import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/lib/supabase/client'
import { createTask, tasksKeys } from '@/features/tasks/api'
import { homeKeys } from '@/features/home/api'
import { buildActionTaskDescription } from '@/shared/meetings/format'
import { createTaskOnce } from '@/shared/meetings/task-dedupe'
import type { LinkedTask, MeetingTaskBridge, MeetingsAdapter } from '@/shared/meetings'

async function findTaskForActionItem(actionItemId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('id')
    .eq('source_action_item_id', actionItemId)
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

export function usePersonalMeetingsAdapter(project: { id: string; name: string } | null | undefined): MeetingsAdapter | null {
  const { t } = useTranslation()
  const { user } = useAuth()

  return useMemo(() => {
    if (!project || !user) return null
    const tasks: MeetingTaskBridge = {
      createTaskFromActionItem: ({ meeting, item, ownerName }) =>
        createTaskOnce({
          findExisting: () => findTaskForActionItem(item.id),
          create: async () => {
            const task = await createTask({
              title: item.title,
              description: buildActionTaskDescription({ item, meeting, ownerName, t }),
              projectId: project.id,
              priority: item.priority ?? 'none',
              dueDate: item.dueDate,
              reminderType: item.dueDate ? 'same_day_morning' : undefined,
              sourceMeetingId: meeting.id,
              sourceActionItemId: item.id,
            })
            return task.id
          },
        }),
      async listTasksForMeeting(meetingId) {
        const { data, error } = await supabase
          .from('tasks')
          .select('id, title, status, source_action_item_id')
          .eq('source_meeting_id', meetingId)
          .neq('status', 'archived')
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
      taskHref: (taskId) => `/personal/tasks/${taskId}`,
      invalidateKeys: [tasksKeys.all, homeKeys.all],
    }
    const displayName =
      (typeof user.user_metadata?.display_name === 'string' && user.user_metadata.display_name) || user.email || 'Hilm'
    return {
      scope: { os: 'personal', userId: user.id, projectId: project.id },
      projectName: project.name,
      canEdit: true,
      canDelete: () => true,
      meetingHref: (meetingId) => `/personal/projects/${project.id}/meetings/${meetingId}`,
      listHref: `/personal/projects/${project.id}?tab=meetings`,
      tasks,
      userDisplayName: displayName,
    }
  }, [project, user, t])
}
