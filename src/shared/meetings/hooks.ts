import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createMeeting,
  deleteActionItem,
  deleteMeeting,
  getMeetingDetail,
  getMeetingQuota,
  linkActionItemToTask,
  listMeetings,
  meetingKeys,
  mergeSpeakers,
  updateActionItem,
  updateMeeting,
  updateSpeaker,
  type ActionItemPatch,
  type MeetingPatch,
} from './api'
import type { CreateMeetingInput, MeetingActionItem, MeetingDetail, MeetingsAdapter } from './types'
import { speakerName } from './format'

const ACTIVE_STATUSES = new Set(['recording', 'processing'])

export function useMeetingsList(adapter: MeetingsAdapter) {
  return useQuery({
    queryKey: meetingKeys.list(adapter.scope),
    queryFn: () => listMeetings(adapter.scope),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((meeting) => ACTIVE_STATUSES.has(meeting.status)) ? 6000 : false,
  })
}

export function useMeetingDetail(adapter: MeetingsAdapter, meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.detail(adapter.scope.os, meetingId),
    queryFn: () => getMeetingDetail(adapter.scope.os, meetingId),
    refetchInterval: (query) => {
      const status = query.state.data?.meeting.status
      return status && ACTIVE_STATUSES.has(status) ? 4000 : false
    },
  })
}

export function useLinkedTasks(adapter: MeetingsAdapter, meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.linkedTasks(adapter.scope.os, meetingId),
    queryFn: () => adapter.tasks.listTasksForMeeting(meetingId),
    enabled,
  })
}

export function useMeetingQuota() {
  return useQuery({ queryKey: meetingKeys.quota(), queryFn: getMeetingQuota, staleTime: 60_000 })
}

export function useMeetingMutations(adapter: MeetingsAdapter, meetingId?: string) {
  const queryClient = useQueryClient()
  const os = adapter.scope.os

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: meetingKeys.list(adapter.scope) })
    if (meetingId) {
      await queryClient.invalidateQueries({ queryKey: meetingKeys.detail(os, meetingId) })
      await queryClient.invalidateQueries({ queryKey: meetingKeys.linkedTasks(os, meetingId) })
    }
  }

  const create = useMutation({
    mutationFn: (input: CreateMeetingInput) => createMeeting(adapter.scope, input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (patch: MeetingPatch) => updateMeeting(os, meetingId!, patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteMeeting(os, id),
    onSuccess: async (_data, id) => {
      queryClient.removeQueries({ queryKey: meetingKeys.detail(os, id) })
      await queryClient.invalidateQueries({ queryKey: meetingKeys.list(adapter.scope) })
    },
  })
  const renameSpeaker = useMutation({
    mutationFn: (input: { speakerId: string; displayName?: string | null; linkedUserId?: string | null }) =>
      updateSpeaker(os, input.speakerId, input),
    onSuccess: invalidate,
  })
  const merge = useMutation({
    mutationFn: (input: { fromId: string; intoId: string }) => mergeSpeakers(os, meetingId!, input.fromId, input.intoId),
    onSuccess: invalidate,
  })
  const editItem = useMutation({
    mutationFn: (input: { itemId: string; patch: ActionItemPatch }) => updateActionItem(os, input.itemId, input.patch),
    onSuccess: invalidate,
  })
  const removeItem = useMutation({
    mutationFn: (itemId: string) => deleteActionItem(os, itemId),
    onSuccess: invalidate,
  })

  return { create, update, remove, renameSpeaker, merge, editItem, removeItem, invalidate }
}

export type CreateTasksResult = { created: number; existing: number; failed: number }

/** Create project tasks from action items, one at a time; the DB unique index blocks duplicates. */
export function useCreateTasksFromActions(adapter: MeetingsAdapter, detail: MeetingDetail | null | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (items: MeetingActionItem[]): Promise<CreateTasksResult> => {
      if (!detail) return { created: 0, existing: 0, failed: 0 }
      const result: CreateTasksResult = { created: 0, existing: 0, failed: 0 }
      const speakers = new Map(detail.speakers.map((speaker) => [speaker.id, speaker]))
      for (const item of items) {
        if (item.taskId) {
          result.existing += 1
          continue
        }
        const owner = item.ownerSpeakerId ? speakers.get(item.ownerSpeakerId) : undefined
        try {
          const { taskId, existed } = await adapter.tasks.createTaskFromActionItem({
            meeting: detail.meeting,
            item,
            ownerName: owner && item.ownerCertainty !== 'none' ? speakerName(owner, owner.label) : null,
            ownerUserId: owner?.linkedUserId ?? null,
          })
          await linkActionItemToTask(adapter.scope.os, item.id, taskId)
          if (existed) result.existing += 1
          else result.created += 1
        } catch (error) {
          console.error('create task from action item failed', error)
          result.failed += 1
        }
      }
      return result
    },
    onSettled: async () => {
      if (!detail) return
      const os = adapter.scope.os
      await queryClient.invalidateQueries({ queryKey: meetingKeys.detail(os, detail.meeting.id) })
      await queryClient.invalidateQueries({ queryKey: meetingKeys.linkedTasks(os, detail.meeting.id) })
      for (const key of adapter.tasks.invalidateKeys) await queryClient.invalidateQueries({ queryKey: [...key] })
    },
  })
}
