import { addDays, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns'
import { taskDueDateKey, toLocalDateKey, todayLocalISO } from '@/lib/dates'
import { dueAtFromLocalSchedule } from '@/features/tasks/reminders'
import type { TaskWithProject } from '@/features/tasks/reminders'

export const WORK_DAY_START = 8
export const WORK_DAY_END = 20
export const HOUR_HEIGHT = 64
export const DEFAULT_TASK_HOURS = 1

export type CalendarView = 'month' | 'week' | 'day'
export type HorizonZoom = 'day' | 'week' | 'month' | 'quarter' | 'year'

export function taskDurationHours(task: TaskWithProject) {
  const hours = task.estimated_hours
  if (typeof hours === 'number' && hours > 0) return Math.min(8, Math.max(0.5, hours))
  return DEFAULT_TASK_HOURS
}

export function taskStartHour(task: TaskWithProject) {
  if (!task.due_at) return WORK_DAY_START
  const date = new Date(task.due_at)
  if (Number.isNaN(date.getTime())) return WORK_DAY_START
  const hour = date.getHours() + date.getMinutes() / 60
  // Untimed dues land at 09:00 — treat as unscheduled for packing.
  if (hour === 9 && date.getMinutes() === 0 && !task.estimated_hours) return WORK_DAY_START
  return Math.max(WORK_DAY_START, Math.min(WORK_DAY_END - 0.5, hour))
}

export type PackedBlock = {
  task: TaskWithProject
  startHour: number
  endHour: number
  top: number
  height: number
}

/** Pack open tasks for a day into the workday timeline. */
export function packDayTimeline(tasks: TaskWithProject[], dayKey: string): PackedBlock[] {
  const dayTasks = tasks
    .filter((task) => taskDueDateKey(task) === dayKey)
    .sort((a, b) => {
      const aDone = a.status === 'done' ? 1 : 0
      const bDone = b.status === 'done' ? 1 : 0
      if (aDone !== bDone) return aDone - bDone
      const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
      const pr = priorityRank[a.priority] - priorityRank[b.priority]
      if (pr !== 0) return pr
      return taskStartHour(a) - taskStartHour(b)
    })

  let cursor = WORK_DAY_START
  const blocks: PackedBlock[] = []
  for (const task of dayTasks) {
    const duration = taskDurationHours(task)
    const preferred = taskStartHour(task)
    const start = task.status === 'done' ? preferred : Math.max(cursor, preferred)
    const end = Math.min(WORK_DAY_END, start + duration)
    blocks.push({
      task,
      startHour: start,
      endHour: end,
      top: (start - WORK_DAY_START) * HOUR_HEIGHT,
      height: Math.max(28, (end - start) * HOUR_HEIGHT - 4),
    })
    if (task.status !== 'done') cursor = end + 0.15
  }
  return blocks
}

export function hourFromTimelineY(y: number) {
  const hour = WORK_DAY_START + y / HOUR_HEIGHT
  return Math.max(WORK_DAY_START, Math.min(WORK_DAY_END - 0.25, Math.round(hour * 4) / 4))
}

export function schedulePatchForDrop(dayKey: string, hour: number) {
  const whole = Math.floor(hour)
  const minutes = Math.round((hour - whole) * 60)
  return {
    due_date: dayKey,
    due_at: dueAtFromLocalSchedule(dayKey, whole, minutes),
  }
}

export function monthMatrix(anchor: Date) {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 })
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 })
  return eachDayOfInterval({ start, end })
}

export function weekDays(anchor: Date) {
  const start = startOfWeek(anchor, { weekStartsOn: 1 })
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export function workloadForDay(tasks: TaskWithProject[], dayKey: string) {
  return tasks
    .filter((task) => taskDueDateKey(task) === dayKey && task.status !== 'done' && task.status !== 'archived')
    .reduce((sum, task) => sum + taskDurationHours(task), 0)
}

export function projectHoursForDay(tasks: TaskWithProject[], dayKey: string) {
  const map = new Map<string, { id: string; name: string; color: string; hours: number }>()
  for (const task of tasks) {
    if (taskDueDateKey(task) !== dayKey) continue
    if (task.status === 'done' || task.status === 'archived') continue
    const id = task.project_id ?? 'none'
    const current = map.get(id) ?? {
      id,
      name: task.projects?.name ?? 'Inbox',
      color: task.projects?.color ?? '#71717a',
      hours: 0,
    }
    current.hours += taskDurationHours(task)
    map.set(id, current)
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours)
}

export function heatmapDays(tasks: TaskWithProject[], weeks = 12) {
  const today = todayLocalISO()
  const end = new Date(`${today}T12:00:00`)
  const start = addDays(end, -(weeks * 7 - 1))
  return eachDayOfInterval({ start, end }).map((day) => {
    const key = toLocalDateKey(day)!
    const hours = workloadForDay(tasks, key)
    return { key, label: format(day, 'MMM d'), hours, date: day }
  })
}

export function heatTone(hours: number) {
  if (hours <= 0) return 'bg-surface-2'
  if (hours < 2) return 'bg-emerald-500/20'
  if (hours < 4) return 'bg-emerald-500/40'
  if (hours < 6) return 'bg-emerald-500/65'
  return 'bg-emerald-400/90'
}

export function buildAiSuggestions(input: {
  overdueCount: number
  todayHours: number
  projectCount: number
  focusTitle?: string | null
}) {
  const tips: string[] = []
  if (input.overdueCount > 0) {
    tips.push(`Move or complete ${input.overdueCount} overdue item${input.overdueCount === 1 ? '' : 's'} before adding new work.`)
  }
  if (input.todayHours > 8) {
    tips.push('Today is overloaded — push lower-priority blocks into tomorrow morning.')
  } else if (input.todayHours < 2) {
    tips.push('Light day — pull one high-priority project block into the afternoon.')
  }
  if (input.projectCount >= 4) {
    tips.push('Too much context switching — batch tasks by project for 90-minute focus blocks.')
  }
  if (input.focusTitle) {
    tips.push(`Protect the next 60 minutes for “${input.focusTitle}”.`)
  }
  if (!tips.length) tips.push('Schedule looks balanced. Keep momentum on the current focus.')
  return tips.slice(0, 4)
}

/** Suggest the next open work-hour slot on a day for an untimed task. */
export function suggestBestSlot(
  tasks: TaskWithProject[],
  dayKey: string,
  durationHours = DEFAULT_TASK_HOURS,
) {
  const blocks = packDayTimeline(
    tasks.filter((task) => task.status !== 'done' && task.status !== 'archived'),
    dayKey,
  )
  if (!blocks.length) {
    const now = new Date()
    const today = todayLocalISO()
    if (dayKey === today) {
      const hour = Math.max(WORK_DAY_START, Math.ceil(now.getHours() + now.getMinutes() / 60))
      return Math.min(WORK_DAY_END - durationHours, hour)
    }
    return WORK_DAY_START + 1
  }
  const last = blocks.reduce((max, block) => Math.max(max, block.endHour), WORK_DAY_START)
  if (last + durationHours <= WORK_DAY_END) return Math.min(WORK_DAY_END - 0.25, last + 0.25)
  return WORK_DAY_START
}
