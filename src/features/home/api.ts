import { endOfDay, startOfDay, addDays } from 'date-fns'
import { listTasks } from '@/features/tasks/api'
import { listProjects } from '@/features/projects/api'
import { listActivity } from '@/features/activity/api'
import { listNotes } from '@/features/notes/api'
import { getDailyLog } from '@/features/daily-log/api'

export const homeKeys = {
  all: ['home'] as const,
  dashboard: () => [...homeKeys.all, 'dashboard'] as const,
}

export async function getDashboardData() {
  const now = new Date()
  const dayStart = startOfDay(now).toISOString()
  const dayEnd = endOfDay(now).toISOString()
  const upcomingEnd = endOfDay(addDays(now, 7)).toISOString()

  const [projects, allTasks, activity, notes, dailyLog] = await Promise.all([
    listProjects(),
    listTasks(),
    listActivity(20),
    listNotes(),
    getDailyLog(),
  ])

  const openTasks = allTasks.filter((t) => t.status !== 'done')
  const todayTasks = openTasks.filter(
    (t) => t.due_at && t.due_at >= dayStart && t.due_at <= dayEnd,
  )
  const overdueTasks = openTasks.filter((t) => t.due_at && t.due_at < dayStart)
  const upcoming = openTasks.filter(
    (t) => t.due_at && t.due_at > dayEnd && t.due_at <= upcomingEnd,
  )
  const inProgress = openTasks.filter((t) => t.status === 'in_progress')
  const focus =
    overdueTasks[0] ??
    todayTasks[0] ??
    inProgress[0] ??
    openTasks.find((t) => t.priority === 'urgent' || t.priority === 'high') ??
    openTasks[0] ??
    null

  const doneThisWeek = allTasks.filter((t) => {
    if (!t.completed_at) return false
    return new Date(t.completed_at) >= addDays(now, -7)
  }).length

  return {
    focus,
    todayTasks,
    overdueTasks,
    upcoming,
    projects,
    activity,
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
