import { taskDueDateKey, toLocalDateKey, todayLocalISO } from '@/lib/dates'
import { dueAtFromLocalSchedule } from '@/shared/reminders'
import type { TaskWithProject } from '@/shared/reminders'
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

export const HOUR_HEIGHT = 56
export const DEFAULT_TASK_HOURS = 1
export const DAY_START = 0
export const DAY_END = 24
/** @deprecated use DAY_START */
export const WORK_DAY_START = DAY_START
/** @deprecated use DAY_END */
export const WORK_DAY_END = DAY_END

export type CalendarView = 'month' | 'week' | 'day'
export type HorizonZoom = 'day' | 'week' | 'month' | 'quarter' | 'year'

export function taskDurationHours(task: TaskWithProject) {
  const hours = task.estimated_hours
  if (typeof hours === 'number' && hours > 0) return Math.min(8, Math.max(0.5, hours))
  return DEFAULT_TASK_HOURS
}

export function taskStartHour(task: TaskWithProject) {
  if (!task.due_at) return 9
  const date = new Date(task.due_at)
  if (Number.isNaN(date.getTime())) return 9
  return date.getHours() + date.getMinutes() / 60
}

export type PackedBlock = {
  task: TaskWithProject
  startHour: number
  endHour: number
  top: number
  height: number
  column: number
  columnCount: number
}

/** Side-by-side packing for overlapping tasks (Google Calendar style). */
export function packDayTimeline(tasks: TaskWithProject[], dayKey: string): PackedBlock[] {
  const dayTasks = tasks
    .filter((task) => taskDueDateKey(task) === dayKey)
    .map((task) => {
      const duration = taskDurationHours(task)
      const start = Math.max(DAY_START, Math.min(DAY_END - 0.25, taskStartHour(task)))
      const end = Math.min(DAY_END, start + duration)
      return { task, startHour: start, endHour: end }
    })
    .sort((a, b) => a.startHour - b.startHour || b.endHour - a.endHour)

  type Active = { end: number; column: number }
  const active: Active[] = []
  const assigned: Array<{ startHour: number; endHour: number; task: TaskWithProject; column: number }> =
    []

  for (const item of dayTasks) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end <= item.startHour) active.splice(i, 1)
    }
    const used = new Set(active.map((a) => a.column))
    let column = 0
    while (used.has(column)) column += 1
    active.push({ end: item.endHour, column })
    assigned.push({ ...item, column })
  }

  // Cluster overlapping groups to set columnCount per cluster
  const blocks: PackedBlock[] = assigned.map((item) => ({
    ...item,
    top: item.startHour * HOUR_HEIGHT,
    height: Math.max(28, (item.endHour - item.startHour) * HOUR_HEIGHT - 4),
    columnCount: 1,
  }))

  for (let i = 0; i < blocks.length; i++) {
    const group = [blocks[i]]
    let maxCol = blocks[i].column
    for (let j = 0; j < blocks.length; j++) {
      if (i === j) continue
      const a = blocks[i]
      const b = blocks[j]
      if (a.startHour < b.endHour && b.startHour < a.endHour) {
        group.push(b)
        maxCol = Math.max(maxCol, b.column)
      }
    }
    const count = maxCol + 1
    for (const g of group) g.columnCount = Math.max(g.columnCount, count)
  }

  return blocks
}

export function hourFromTimelineY(y: number) {
  const hour = y / HOUR_HEIGHT
  return Math.max(DAY_START, Math.min(DAY_END - 0.25, Math.round(hour * 4) / 4))
}

export function schedulePatchForDrop(dayKey: string, hour: number, durationHours = DEFAULT_TASK_HOURS) {
  const whole = Math.floor(hour)
  const minutes = Math.round((hour - whole) * 60)
  const endHour = Math.min(DAY_END, hour + durationHours)
  return {
    due_date: dayKey,
    due_at: dueAtFromLocalSchedule(dayKey, whole, minutes),
    estimated_hours: Math.max(0.5, Math.round((endHour - hour) * 4) / 4),
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
      const hour = Math.ceil(now.getHours() + now.getMinutes() / 60)
      return Math.min(DAY_END - durationHours, Math.max(0, hour))
    }
    return 9
  }
  const last = blocks.reduce((max, block) => Math.max(max, block.endHour), 0)
  if (last + durationHours <= DAY_END) return Math.min(DAY_END - 0.25, last + 0.25)
  return 9
}
