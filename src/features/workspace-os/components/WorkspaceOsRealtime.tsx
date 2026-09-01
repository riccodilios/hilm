import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { workspaceKeys } from '@/features/workspace-os/api'
import { supabase } from '@/lib/supabase/client'

/** Live sync for workspace OS tables within the active workspace. */
export function WorkspaceOsRealtime() {
  const { workspaceId = '' } = useParams()
  const qc = useQueryClient()

  useEffect(() => {
    if (!workspaceId) return

    const invalidate = () => {
      void Promise.all([
        qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) }),
        qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) }),
        qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) }),
        qc.invalidateQueries({ queryKey: workspaceKeys.activity(workspaceId) }),
        qc.invalidateQueries({ queryKey: ['workspace-os', 'task', workspaceId] }),
        qc.invalidateQueries({ queryKey: ['workspace-os', 'project', workspaceId] }),
      ])
    }

    const channel = supabase
      .channel(`workspace-os-live-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_tasks',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        invalidate,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_projects',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        invalidate,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_activity_events',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        invalidate,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [workspaceId, qc])

  return null
}
