import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import {
  listWorkspaceMembers,
  listWorkspaceTasks,
  updateWorkspaceTask,
  workspaceKeys,
  type WorkspaceMember,
  type WorkspaceTask,
} from '@/features/workspace-os/api'
import type { Json, Tables } from '@/types/database'

export type LoadBalanceMode = 'suggest' | 'auto'

export type MemberWorkload = {
  userId: string
  openCount: number
  urgentCount: number
  highCount: number
}

export type LoadBalanceSuggestion = {
  taskId: string
  taskTitle: string
  priority: WorkspaceTask['priority']
  suggestedAssigneeId: string | null
  score: number
  rationale: string
}

export type AssigneeRecommendation = {
  userId: string
  score: number
  confidence: number
  reasons: string[]
}

export type MemberCapacity = {
  userId: string
  openCount: number
  urgentCount: number
  highCount: number
  capacity: 'low' | 'medium' | 'high' | 'overloaded'
  upcomingDeadlines: number
  skills: string[]
  available: boolean
}

export const loadBalancerKeys = {
  all: (workspaceId: string) => [...workspaceKeys.all, 'load-balancer', workspaceId] as const,
  runs: (workspaceId: string) => [...loadBalancerKeys.all(workspaceId), 'runs'] as const,
}

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: 1,
}

async function recordWsActivity(input: {
  workspaceId: string
  eventType: string
  summary: string
  entityType?: string
  entityId?: string
  payload?: Record<string, unknown>
}) {
  const userId = await requireUserId()
  await supabase.from('workspace_activity_events').insert({
    workspace_id: input.workspaceId,
    actor_id: userId,
    event_type: input.eventType,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    summary: input.summary,
    payload: (input.payload ?? {}) as Json,
  })
}

export function getUnassignedOpenTasks(tasks: WorkspaceTask[]) {
  return tasks.filter(
    (task) =>
      !task.assignee_id &&
      task.status !== 'done' &&
      task.status !== 'archived',
  )
}

export function scoreMemberWorkloads(
  members: WorkspaceMember[],
  tasks: WorkspaceTask[],
): MemberWorkload[] {
  const openTasks = tasks.filter(
    (task) => task.status !== 'done' && task.status !== 'archived',
  )
  return members.map((member) => {
    const assigned = openTasks.filter((task) => task.assignee_id === member.user_id)
    return {
      userId: member.user_id,
      openCount: assigned.length,
      urgentCount: assigned.filter((task) => task.priority === 'urgent').length,
      highCount: assigned.filter((task) => task.priority === 'high').length,
    }
  })
}

function capacityFromLoad(openCount: number, urgentCount: number): MemberCapacity['capacity'] {
  const load = openCount + urgentCount * 2
  if (load >= 10) return 'overloaded'
  if (load >= 6) return 'high'
  if (load >= 3) return 'medium'
  return 'low'
}

export function buildMemberCapacities(
  members: WorkspaceMember[],
  tasks: WorkspaceTask[],
  settingsByUser: Map<string, { skills?: string[] | null; availability?: Record<string, unknown> | null }> = new Map(),
): MemberCapacity[] {
  const workloads = scoreMemberWorkloads(members, tasks)
  const now = Date.now()
  const week = now + 7 * 24 * 60 * 60 * 1000
  return workloads.map((w) => {
    const settings = settingsByUser.get(w.userId)
    const availability = settings?.availability ?? {}
    const available =
      availability.available !== false &&
      availability.status !== 'ooo' &&
      availability.status !== 'unavailable'
    const upcomingDeadlines = tasks.filter((task) => {
      if (task.assignee_id !== w.userId) return false
      if (task.status === 'done' || task.status === 'archived') return false
      const due = task.due_at ? new Date(task.due_at).getTime() : null
      return due != null && due >= now && due <= week
    }).length
    return {
      userId: w.userId,
      openCount: w.openCount,
      urgentCount: w.urgentCount,
      highCount: w.highCount,
      capacity: capacityFromLoad(w.openCount, w.urgentCount),
      upcomingDeadlines,
      skills: settings?.skills ?? [],
      available,
    }
  })
}

export function recommendAssignee(input: {
  members: WorkspaceMember[]
  tasks: WorkspaceTask[]
  priority?: WorkspaceTask['priority']
  estimatedHours?: number | null
  dueAt?: string | null
  candidateIds?: string[] | null
  settingsByUser?: Map<string, { skills?: string[] | null; availability?: Record<string, unknown> | null }>
  titleHint?: string
}): AssigneeRecommendation | null {
  const candidates = input.candidateIds?.length
    ? input.members.filter((m) => input.candidateIds!.includes(m.user_id))
    : input.members
  if (!candidates.length) return null

  const capacities = buildMemberCapacities(
    candidates,
    input.tasks,
    input.settingsByUser ?? new Map(),
  )
  const title = (input.titleHint ?? '').toLowerCase()
  const priorityWeight = PRIORITY_WEIGHT[input.priority ?? 'none'] ?? 1

  const ranked = capacities
    .map((cap) => {
      const reasons: string[] = []
      let score = 100 - (cap.openCount * 8 + cap.urgentCount * 12 + cap.highCount * 4)

      if (cap.available) {
        score += 12
        reasons.push('Available this week')
      } else {
        score -= 30
        reasons.push('Marked unavailable')
      }

      if (cap.capacity === 'low') {
        score += 18
        reasons.push('Lowest workload')
      } else if (cap.capacity === 'medium') {
        score += 6
        reasons.push(`${cap.openCount} open tasks`)
      } else if (cap.capacity === 'high') {
        score -= 8
        reasons.push('High current load')
      } else {
        score -= 20
        reasons.push('Overloaded')
      }

      if (cap.upcomingDeadlines === 0) {
        score += 6
        reasons.push('No deadlines this week')
      } else {
        score -= cap.upcomingDeadlines * 3
        reasons.push(`${cap.upcomingDeadlines} upcoming deadline(s)`)
      }

      const matchedSkills = cap.skills.filter((skill) => {
        const s = skill.toLowerCase()
        return s.length > 1 && title.includes(s)
      })
      if (matchedSkills.length) {
        score += matchedSkills.length * 10
        reasons.push(`Relevant ${matchedSkills[0]} experience`)
      }

      if ((input.estimatedHours ?? 0) > 8 && cap.capacity === 'low') {
        score += 8
        reasons.push('Capacity for larger effort')
      }

      score += priorityWeight * 2

      const confidence = Math.max(5, Math.min(98, Math.round(score)))
      return { userId: cap.userId, score, confidence, reasons: reasons.slice(0, 4) }
    })
    .sort((a, b) => b.score - a.score)

  return ranked[0] ?? null
}

export function suggestAssignees(
  unassigned: WorkspaceTask[],
  workloads: MemberWorkload[],
): LoadBalanceSuggestion[] {
  if (!workloads.length) {
    return unassigned.map((task) => ({
      taskId: task.id,
      taskTitle: task.title,
      priority: task.priority,
      suggestedAssigneeId: null,
      score: 0,
      rationale: 'No workspace members available',
    }))
  }

  const mutable = workloads.map((w) => ({ ...w }))

  return unassigned.map((task) => {
    const priorityWeight = PRIORITY_WEIGHT[task.priority] ?? 1
    const ranked = [...mutable].sort((a, b) => {
      const scoreA = a.openCount + a.urgentCount * 2 + a.highCount
      const scoreB = b.openCount + b.urgentCount * 2 + b.highCount
      return scoreA - scoreB
    })
    const best = ranked[0]
    const loadPenalty = best.openCount + best.urgentCount * 2 + best.highCount
    const score = Math.max(0, 100 - loadPenalty * 8 + priorityWeight * 5)

    best.openCount += 1
    if (task.priority === 'urgent') best.urgentCount += 1
    if (task.priority === 'high') best.highCount += 1

    return {
      taskId: task.id,
      taskTitle: task.title,
      priority: task.priority,
      suggestedAssigneeId: best.userId,
      score,
      rationale: `Lowest workload (${best.openCount - 1} open tasks) · priority ${task.priority}`,
    }
  })
}

async function notifyAssignment(
  workspaceId: string,
  assigneeId: string,
  task: WorkspaceTask,
) {
  await supabase.from('notifications').insert({
    user_id: assigneeId,
    channel: 'in_app',
    type: 'workspace.task.assigned',
    title: 'Task assigned',
    body: `You were assigned "${task.title}"`,
    entity_type: 'workspace_task',
    entity_id: task.id,
    href: `/workspace/${workspaceId}/tasks/${task.id}`,
  })
}

export async function runLoadBalance(
  workspaceId: string,
  mode: LoadBalanceMode,
): Promise<{
  run: Tables<'workspace_load_balance_runs'>
  suggestions: Tables<'workspace_load_balance_suggestions'>[]
}> {
  const userId = await requireUserId()
  const [tasks, members] = await Promise.all([
    listWorkspaceTasks(workspaceId),
    listWorkspaceMembers(workspaceId),
  ])

  const unassigned = getUnassignedOpenTasks(tasks)
  const workloads = scoreMemberWorkloads(members, tasks)
  const computed = suggestAssignees(unassigned, workloads)

  const { data: run, error: runError } = await supabase
    .from('workspace_load_balance_runs')
    .insert({
      workspace_id: workspaceId,
      mode,
      created_by: userId,
      summary: `${computed.length} suggestions (${mode})`,
    })
    .select('*')
    .single()
  if (runError) throw runError

  const suggestionRows = computed.map((item) => ({
    workspace_id: workspaceId,
    run_id: run.id,
    task_id: item.taskId,
    suggested_assignee_id: item.suggestedAssigneeId,
    score: item.score,
    rationale: item.rationale,
    mode,
    applied_at: mode === 'auto' && item.suggestedAssigneeId ? new Date().toISOString() : null,
  }))

  const { data: saved, error: sugError } = await supabase
    .from('workspace_load_balance_suggestions')
    .insert(suggestionRows)
    .select('*')
  if (sugError) throw sugError

  if (mode === 'auto') {
    for (const item of computed) {
      if (!item.suggestedAssigneeId) continue
      const task = tasks.find((t) => t.id === item.taskId)
      if (!task) continue
      await updateWorkspaceTask(workspaceId, item.taskId, {
        assignee_id: item.suggestedAssigneeId,
      })
      await notifyAssignment(workspaceId, item.suggestedAssigneeId, task)
    }
    await recordWsActivity({
      workspaceId,
      eventType: 'load_balance.applied',
      summary: `Auto-assigned ${computed.filter((s) => s.suggestedAssigneeId).length} tasks`,
      entityType: 'load_balance_run',
      entityId: run.id,
    })
  } else {
    await recordWsActivity({
      workspaceId,
      eventType: 'load_balance.suggested',
      summary: `Generated ${computed.length} assignment suggestions`,
      entityType: 'load_balance_run',
      entityId: run.id,
    })
  }

  return {
    run: run as Tables<'workspace_load_balance_runs'>,
    suggestions: (saved ?? []) as Tables<'workspace_load_balance_suggestions'>[],
  }
}

export async function applySuggestion(
  workspaceId: string,
  suggestionId: string,
  taskId: string,
  assigneeId: string,
) {
  const tasks = await listWorkspaceTasks(workspaceId)
  const task = tasks.find((t) => t.id === taskId)
  if (!task) throw new Error('Task not found')

  await updateWorkspaceTask(workspaceId, taskId, { assignee_id: assigneeId })
  await notifyAssignment(workspaceId, assigneeId, task)

  const { error } = await supabase
    .from('workspace_load_balance_suggestions')
    .update({ applied_at: new Date().toISOString() })
    .eq('id', suggestionId)
    .eq('workspace_id', workspaceId)
  if (error) throw error

  await recordWsActivity({
    workspaceId,
    eventType: 'load_balance.applied',
    summary: `Assigned "${task.title}"`,
    entityType: 'task',
    entityId: taskId,
  })
}

export async function listLoadBalanceRuns(workspaceId: string, limit = 10) {
  const { data, error } = await supabase
    .from('workspace_load_balance_runs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as Tables<'workspace_load_balance_runs'>[]
}
