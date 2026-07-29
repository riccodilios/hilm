import { addDays } from 'date-fns'
import { listTasks } from '@/features/tasks/api'
import { listProjects } from '@/features/projects/api'
import { listActivity } from '@/features/activity/api'
import { listNotes } from '@/features/notes/api'
import { getDailyLog } from '@/features/daily-log/api'
import { supabase } from '@/lib/supabase/client'
import {
  addLocalDays,
  taskDueDateKey,
  taskDueInstant,
  todayLocalISO,
} from '@/lib/dates'
import {
  computeProjectHealth,
  toPersistedHealthStatus,
  type Momentum,
  type ProjectHealth,
} from '@/features/projects/health'
import type { Tables } from '@/types/database'
import type { TaskWithProject } from '@/features/tasks/reminders'

export const homeKeys = {
  all: ['home'] as const,
  dashboard: () => [...homeKeys.all, 'dashboard'] as const,
}

export type ProjectInsight = Tables<'projects'> & {
  health: ProjectHealth
  remainingTasks: number
  overdueCount: number
  lastActiveAt: string | null
  nextDeadline: string | null
  momentum: Momentum
  healthExplanation: string
}

function isOpenTask(task: TaskWithProject) {
  return task.status !== 'done' && task.status !== 'archived'
}

function sortByDue(a: TaskWithProject, b: TaskWithProject) {
  const aDue = taskDueInstant(a)?.getTime() ?? Number.POSITIVE_INFINITY
  const bDue = taskDueInstant(b)?.getTime() ?? Number.POSITIVE_INFINITY
  return aDue - bDue
}

async function loadRoadmapCounts(projectIds: string[]) {
  const map = new Map<string, { total: number; done: number }>()
  if (!projectIds.length) return map
  const { data, error } = await supabase
    .from('roadmap_items')
    .select('project_id, horizon')
    .in('project_id', projectIds)
  if (error) throw error
  for (const item of data ?? []) {
    const current = map.get(item.project_id) ?? { total: 0, done: 0 }
    current.total += 1
    // Treat "now" horizon items as in-flight; no explicit done flag — use later/future as remaining bias.
    if (item.horizon === 'now') current.done += 0
    map.set(item.project_id, current)
  }
  return map
}

export async function getDashboardData() {
  const now = new Date()
  const todayKey = todayLocalISO()
  const tomorrowKey = addLocalDays(todayKey, 1)
  const weekAgo = addDays(now, -7).toISOString()
  const twoWeeksAgo = addDays(now, -14).toISOString()

  const [projects, allTasks, activity, notes, dailyLog] = await Promise.all([
    listProjects(),
    listTasks(),
    listActivity(80),
    listNotes(),
    getDailyLog(),
  ])

  const openTasks = allTasks.filter(isOpenTask)
  const todayTasks = openTasks
    .filter((task) => taskDueDateKey(task) === todayKey)
    .sort(sortByDue)
  const tomorrowTasks = openTasks
    .filter((task) => taskDueDateKey(task) === tomorrowKey)
    .sort(sortByDue)
  const overdueTasks = openTasks
    .filter((task) => {
      const key = taskDueDateKey(task)
      return Boolean(key && key < todayKey)
    })
    .sort(sortByDue)
  const upcoming = openTasks
    .filter((task) => {
      const key = taskDueDateKey(task)
      if (!key) return false
      // Include tomorrow through the next 7 days (no separate tomorrow widget).
      return key > todayKey && key <= addLocalDays(todayKey, 7)
    })
    .sort(sortByDue)

  const inProgress = openTasks.filter((task) => task.status === 'in_progress')
  const focus =
    overdueTasks[0] ??
    todayTasks[0] ??
    tomorrowTasks[0] ??
    inProgress[0] ??
    openTasks.find((task) => task.priority === 'urgent' || task.priority === 'high') ??
    openTasks[0] ??
    null

  const doneThisWeek = allTasks.filter((task) => {
    if (!task.completed_at) return false
    return new Date(task.completed_at) >= addDays(now, -7)
  }).length

  const roadmapMap = await loadRoadmapCounts(projects.map((project) => project.id))
  const notesByProject = new Map<string, number>()
  for (const note of notes) {
    if (!note.project_id) continue
    notesByProject.set(note.project_id, (notesByProject.get(note.project_id) ?? 0) + 1)
  }

  const projectInsights: ProjectInsight[] = projects.map((project) => {
    const projectTasks = allTasks.filter((task) => task.project_id === project.id)
    const open = projectTasks.filter(isOpenTask)
    const done = projectTasks.filter((task) => task.status === 'done')
    const overdueCount = open.filter((task) => {
      const key = taskDueDateKey(task)
      return Boolean(key && key < todayKey)
    }).length
    const waitingCount = open.filter((task) => task.status === 'waiting').length
    const inProgressCount = open.filter((task) => task.status === 'in_progress').length
    const total = projectTasks.filter((task) => task.status !== 'archived').length
    const doneCount = done.length
    const pct = total === 0 ? 0 : Math.round((doneCount / total) * 1000) / 10

    const projectActivity = activity.filter((event) => event.project_id === project.id)
    const lastFromActivity = projectActivity[0]?.created_at ?? null
    const lastFromTasks = projectTasks.reduce<string | null>((latest, task) => {
      const stamp = task.updated_at || task.completed_at || task.created_at
      if (!stamp) return latest
      if (!latest || stamp > latest) return stamp
      return latest
    }, null)
    const lastActiveAt =
      [lastFromActivity, lastFromTasks, project.updated_at].filter(Boolean).sort().at(-1) ?? null

    const recentCompletions7d = done.filter(
      (task) => task.completed_at && task.completed_at >= weekAgo,
    ).length
    const priorCompletions7d = done.filter(
      (task) =>
        task.completed_at && task.completed_at >= twoWeeksAgo && task.completed_at < weekAgo,
    ).length

    const roadmap = roadmapMap.get(project.id) ?? { total: 0, done: 0 }
    const computed = computeProjectHealth({
      completionPct: pct,
      totalTasks: total,
      doneTasks: doneCount,
      openTasks: open.length,
      overdueCount,
      waitingCount,
      inProgressCount,
      notesCount: notesByProject.get(project.id) ?? 0,
      roadmapTotal: roadmap.total,
      roadmapDone: roadmap.done,
      lastActivityAt: lastActiveAt,
      recentCompletions7d,
      priorCompletions7d,
    })

    const nextDeadlineTask = open
      .filter((task) => taskDueDateKey(task))
      .sort(sortByDue)[0]

    return {
      ...project,
      completion_pct: pct,
      health: computed.health,
      healthExplanation: computed.explanation,
      remainingTasks: open.length,
      overdueCount,
      lastActiveAt,
      nextDeadline: nextDeadlineTask ? taskDueInstant(nextDeadlineTask)?.toISOString() ?? null : null,
      momentum: computed.momentum,
    }
  })

  // Persist completion + explanation quietly so project views stay honest.
  void Promise.all(
    projectInsights.map(async (insight) => {
      const raw = projects.find((project) => project.id === insight.id)
      if (
        raw &&
        Math.abs(Number(raw.completion_pct) - insight.completion_pct) < 0.05 &&
        (raw.health_explanation ?? '') === insight.healthExplanation
      ) {
        return
      }
      await supabase
        .from('projects')
        .update({
          completion_pct: insight.completion_pct,
          health: toPersistedHealthStatus(insight.health),
          health_explanation: insight.healthExplanation,
        })
        .eq('id', insight.id)
    }),
  ).catch(() => undefined)

  return {
    focus,
    todayTasks,
    tomorrowTasks,
    overdueTasks,
    upcoming,
    projects: projectInsights,
    activity: activity.slice(0, 20),
    recentNotes: notes.slice(0, 5),
    dailyLog,
    stats: {
      openCount: openTasks.length,
      doneThisWeek,
      projectCount: projects.length,
      overdueCount: overdueTasks.length,
    },
  }
}
