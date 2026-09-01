import { addDays } from 'date-fns'
import {
  computeProjectHealth,
  toPersistedHealthStatus,
} from '@/shared/project-health/health'
import { supabase } from '@/lib/supabase/client'
import type { WorkspaceProject } from '@/features/workspace-os/api'

function taskDueDateKey(task: { due_date: string | null; due_at: string | null }) {
  if (task.due_date) return task.due_date.slice(0, 10)
  if (task.due_at) {
    const d = new Date(task.due_at)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return null
}

/** Recompute workspace project completion + health from tasks and activity. */
export async function refreshWorkspaceProjectCompletion(
  workspaceId: string,
  projectId: string,
): Promise<WorkspaceProject | null> {
  if (!projectId) return null
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const weekAgo = addDays(now, -7).toISOString()
  const twoWeeksAgo = addDays(now, -14).toISOString()

  const [{ data: tasks, error }, { data: activity }] = await Promise.all([
    supabase
      .from('workspace_tasks')
      .select('status, due_date, due_at, completed_at, updated_at, created_at')
      .eq('workspace_id', workspaceId)
      .eq('project_id', projectId)
      .neq('status', 'archived'),
    supabase
      .from('workspace_activity_events')
      .select('created_at')
      .eq('workspace_id', workspaceId)
      .eq('entity_type', 'project')
      .eq('entity_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1),
  ])
  if (error) throw error

  const list = tasks ?? []
  const open = list.filter((task) => task.status !== 'done')
  const done = list.filter((task) => task.status === 'done')
  const total = list.length
  const pct = total === 0 ? 0 : Math.round((done.length / total) * 1000) / 10
  const overdueCount = open.filter((task) => {
    const key = taskDueDateKey(task)
    return Boolean(key && key < todayKey)
  }).length

  const lastFromTasks = list.reduce<string | null>((latest, task) => {
    const stamp = task.updated_at || task.completed_at || task.created_at
    if (!stamp) return latest
    if (!latest || stamp > latest) return stamp
    return latest
  }, null)
  const lastActiveAt = activity?.[0]?.created_at ?? lastFromTasks

  const computed = computeProjectHealth({
    completionPct: pct,
    totalTasks: total,
    doneTasks: done.length,
    openTasks: open.length,
    overdueCount,
    waitingCount: open.filter((task) => task.status === 'waiting').length,
    inProgressCount: open.filter((task) => task.status === 'in_progress').length,
    notesCount: 0,
    roadmapTotal: 0,
    roadmapDone: 0,
    lastActivityAt: lastActiveAt,
    recentCompletions7d: done.filter((task) => task.completed_at && task.completed_at >= weekAgo)
      .length,
    priorCompletions7d: done.filter(
      (task) =>
        task.completed_at && task.completed_at >= twoWeeksAgo && task.completed_at < weekAgo,
    ).length,
  })

  const { data, error: updateError } = await supabase
    .from('workspace_projects')
    .update({
      completion_pct: pct,
      health: toPersistedHealthStatus(computed.health),
      health_explanation: computed.explanation,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', projectId)
    .select('*')
    .maybeSingle()
  if (updateError) throw updateError
  return (data as WorkspaceProject | null) ?? null
}
