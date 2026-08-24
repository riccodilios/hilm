/** Authoritative clock for Hilm AI prompts — prefer the user's local calendar day. */

export type AiClientClock = {
  timezone?: string
  /** Instant from the client clock (ISO). */
  clientNow?: string
  /** User's local calendar day YYYY-MM-DD — preferred over deriving from timezone alone. */
  clientLocalDate?: string
  locale?: string
}

export type ResolvedAiClock = {
  timeZone: string
  now: Date
  localDate: string
  tomorrowDate: string
  yesterdayDate: string
  localNowLabel: string
  utcNowIso: string
}

function isValidTimeZone(tz: string) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

function addCalendarDays(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  utc.setUTCDate(utc.getUTCDate() + days)
  return utc.toISOString().slice(0, 10)
}

/** YYYY-MM-DD in a given IANA timezone. */
export function localDateKeyInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function resolveAiClock(input: AiClientClock = {}): ResolvedAiClock {
  const timeZone =
    input.timezone && isValidTimeZone(input.timezone) ? input.timezone : 'UTC'

  const parsedClient = input.clientNow ? new Date(input.clientNow) : null
  const now =
    parsedClient && !Number.isNaN(parsedClient.getTime()) ? parsedClient : new Date()

  const derivedLocal = localDateKeyInZone(now, timeZone)
  const localDate =
    input.clientLocalDate && /^\d{4}-\d{2}-\d{2}$/.test(input.clientLocalDate)
      ? input.clientLocalDate
      : derivedLocal

  const locale = input.locale?.startsWith('ar') ? 'ar' : 'en-US'
  const localNowLabel = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  }).format(now)

  return {
    timeZone,
    now,
    localDate,
    tomorrowDate: addCalendarDays(localDate, 1),
    yesterdayDate: addCalendarDays(localDate, -1),
    localNowLabel,
    utcNowIso: now.toISOString(),
  }
}

export function buildAiTimeContextPrompt(clock: ResolvedAiClock) {
  return `Temporal context (authoritative — never invent a different "today" or ignore this clock):
- User timezone: ${clock.timeZone}
- Local now: ${clock.localNowLabel}
- Local calendar date (TODAY): ${clock.localDate}
- Yesterday: ${clock.yesterdayDate}
- Tomorrow: ${clock.tomorrowDate}
- UTC instant: ${clock.utcNowIso}
Rules:
- "Today" means ${clock.localDate}. Dates after today (including ${clock.tomorrowDate}) have NOT passed.
- A task is overdue only when its local due date is before TODAY, or when a specific due datetime is before the local now above.
- When scheduling, express dueAt as ISO-8601 with timezone offset or Z, and reason in the user's local day.
- Do not use training-cutoff dates, provider clocks, or guessed years. Trust only this temporal context.`
}

type DueTaskLike = {
  due_date?: string | null
  due_at?: string | null
  status?: string | null
  [key: string]: unknown
}

/** Prefer due_date (calendar), else map due_at into the user's timezone. */
export function taskDueLocalDate(
  task: Pick<DueTaskLike, 'due_date' | 'due_at'>,
  timeZone: string,
): string | null {
  if (task.due_date && typeof task.due_date === 'string') {
    const key = task.due_date.trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key
  }
  if (!task.due_at) return null
  const instant = new Date(task.due_at)
  if (Number.isNaN(instant.getTime())) return null
  return localDateKeyInZone(instant, timeZone)
}

export function annotateTasksForAi<T extends DueTaskLike>(tasks: T[], clock: ResolvedAiClock) {
  return tasks.map((task) => {
    const dueLocalDate = taskDueLocalDate(task, clock.timeZone)
    let dueStatus: 'none' | 'overdue' | 'today' | 'tomorrow' | 'upcoming' = 'none'
    if (dueLocalDate) {
      if (dueLocalDate < clock.localDate) dueStatus = 'overdue'
      else if (dueLocalDate === clock.localDate) dueStatus = 'today'
      else if (dueLocalDate === clock.tomorrowDate) dueStatus = 'tomorrow'
      else dueStatus = 'upcoming'
    }
    const workState = task.status === 'done' ? ('done' as const) : ('open' as const)
    return {
      ...task,
      dueLocalDate,
      dueStatus,
      workState,
      // Help the model: ISO due_at alone is easy to misread across timezones.
      todayLocalDate: clock.localDate,
    }
  })
}

const DUE_RANK: Record<string, number> = {
  overdue: 0,
  today: 1,
  tomorrow: 2,
  upcoming: 3,
  none: 4,
}

/**
 * Prefer open/overdue work, then a small slice of recently completed tasks,
 * so the model can tell what is already done vs still open.
 */
export function packTasksForAiContext<T extends DueTaskLike>(
  tasks: T[],
  clock: ResolvedAiClock,
  opts?: { openLimit?: number; doneLimit?: number },
) {
  const openLimit = opts?.openLimit ?? 30
  const doneLimit = opts?.doneLimit ?? 10
  const annotated = annotateTasksForAi(tasks, clock)
  const open = annotated
    .filter((task) => task.workState === 'open')
    .sort((a, b) => (DUE_RANK[a.dueStatus] ?? 9) - (DUE_RANK[b.dueStatus] ?? 9))
  const done = annotated.filter((task) => task.workState === 'done')
  const packed = [...open.slice(0, openLimit), ...done.slice(0, doneLimit)]

  const byProject = new Map<
    string,
    { projectId: string; open: number; done: number; overdue: number }
  >()
  for (const task of annotated) {
    const projectId =
      typeof task.project_id === 'string' && task.project_id ? task.project_id : 'unassigned'
    const row = byProject.get(projectId) ?? {
      projectId,
      open: 0,
      done: 0,
      overdue: 0,
    }
    if (task.workState === 'done') row.done += 1
    else {
      row.open += 1
      if (task.dueStatus === 'overdue') row.overdue += 1
    }
    byProject.set(projectId, row)
  }

  return {
    tasks: packed,
    workSummary: {
      open: open.length,
      done: done.length,
      overdue: open.filter((task) => task.dueStatus === 'overdue').length,
      byProject: [...byProject.values()],
    },
  }
}
