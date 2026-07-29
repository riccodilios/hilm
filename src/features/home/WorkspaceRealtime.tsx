import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { homeKeys } from '@/features/home/api'
import { tasksKeys } from '@/features/tasks/api'
import { projectsKeys } from '@/features/projects/api'
import { activityKeys } from '@/features/activity/api'
import { notesKeys } from '@/features/notes/api'
import { dailyLogKeys } from '@/features/daily-log/api'
import { supabase } from '@/lib/supabase/client'

/** Keep dashboard widgets synced with live workspace writes. */
export function WorkspaceRealtime() {
  const { user } = useAuth()
  const qc = useQueryClient()

  useEffect(() => {
    if (!user) return

    const invalidateWorkspace = () => {
      void Promise.all([
        qc.invalidateQueries({ queryKey: homeKeys.all }),
        qc.invalidateQueries({ queryKey: tasksKeys.all }),
        qc.invalidateQueries({ queryKey: projectsKeys.all }),
        qc.invalidateQueries({ queryKey: activityKeys.all }),
        qc.invalidateQueries({ queryKey: notesKeys.all }),
        qc.invalidateQueries({ queryKey: dailyLogKeys.all }),
      ])
    }

    const channel = supabase
      .channel(`workspace-live-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${user.id}` },
        invalidateWorkspace,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects', filter: `user_id=eq.${user.id}` },
        invalidateWorkspace,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activity_events', filter: `user_id=eq.${user.id}` },
        invalidateWorkspace,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${user.id}` },
        invalidateWorkspace,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_logs', filter: `user_id=eq.${user.id}` },
        invalidateWorkspace,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user, qc])

  return null
}
