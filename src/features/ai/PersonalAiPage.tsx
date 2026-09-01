import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AiChatShell } from '@/shared/ai/AiChatShell'
import { usePersonalPreviewDirectory } from '@/features/ai/lib/use-personal-preview-directory'
import { activityKeys } from '@/features/activity/api'
import { homeKeys } from '@/features/home/api'
import { ideasKeys } from '@/features/ideas/api'
import { notesKeys } from '@/features/notes/api'
import { labelKeys } from '@/features/projects/labels-api'
import { projectsKeys } from '@/features/projects/api'
import { tasksKeys } from '@/features/tasks/api'
import { ensurePersonalAiRegistry } from '@/features/ai/registry/personal-bootstrap'

ensurePersonalAiRegistry()

export function PersonalAiPage() {
  const queryClient = useQueryClient()
  const previewDirectory = usePersonalPreviewDirectory(true)

  const onInvalidateAfterActions = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tasksKeys.all }),
      queryClient.invalidateQueries({ queryKey: projectsKeys.all }),
      queryClient.invalidateQueries({ queryKey: homeKeys.all }),
      queryClient.invalidateQueries({ queryKey: activityKeys.all }),
      queryClient.invalidateQueries({ queryKey: ideasKeys.all }),
      queryClient.invalidateQueries({ queryKey: notesKeys.all }),
      queryClient.invalidateQueries({ queryKey: labelKeys.all }),
    ])
  }, [queryClient])

  return (
    <AiChatShell
      mode="personal"
      previewDirectory={previewDirectory}
      onInvalidateAfterActions={onInvalidateAfterActions}
    />
  )
}
