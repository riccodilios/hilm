import type { HealthStatus } from '@/types/domain'

/** Intelligent project health — computed from real activity, never a static default. */
export type ProjectHealth =
  | 'unengaged'
  | 'started'
  | 'active'
  | 'healthy'
  | 'near_completion'
  | 'blocked'
  | 'stalled'

export type Momentum = 'up' | 'flat' | 'down'

export type ProjectHealthInput = {
  completionPct: number
  totalTasks: number
  doneTasks: number
  openTasks: number
  overdueCount: number
  waitingCount: number
  inProgressCount: number
  notesCount: number
  roadmapTotal: number
  roadmapDone: number
  lastActivityAt: string | null
  recentCompletions7d: number
  priorCompletions7d: number
  stalledAfterDays?: number
}

export type ProjectHealthResult = {
  health: ProjectHealth
  momentum: Momentum
  explanation: string
}

function daysSince(iso: string | null, now = new Date()) {
  if (!iso) return Number.POSITIVE_INFINITY
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return Number.POSITIVE_INFINITY
  return (now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24)
}

export function computeProjectHealth(input: ProjectHealthInput): ProjectHealthResult {
  const stalledAfter = input.stalledAfterDays ?? 14
  const idleDays = daysSince(input.lastActivityAt)
  const pct = Number.isFinite(input.completionPct) ? input.completionPct : 0
  const hasWork = input.totalTasks > 0
  const hasProgress =
    input.doneTasks > 0 || pct > 0 || input.inProgressCount > 0 || input.notesCount > 0
  const milestoneShare =
    input.roadmapTotal > 0 ? input.roadmapDone / input.roadmapTotal : null

  let momentum: Momentum = 'flat'
  if (input.recentCompletions7d > input.priorCompletions7d) momentum = 'up'
  else if (input.recentCompletions7d < input.priorCompletions7d) momentum = 'down'

  // Blockers first — overdue open work or waiting pile with overdue pressure.
  if (input.overdueCount > 0 || (input.waitingCount >= 2 && input.openTasks > 0 && idleDays >= 3)) {
    return {
      health: 'blocked',
      momentum,
      explanation: input.overdueCount
        ? `${input.overdueCount} overdue task${input.overdueCount === 1 ? '' : 's'}`
        : 'Waiting items and stalled open work',
    }
  }

  // Unfinished work with no signal for a long stretch.
  if (input.openTasks > 0 && idleDays >= stalledAfter) {
    return {
      health: 'stalled',
      momentum: 'down',
      explanation: `No activity for ${Math.floor(idleDays)} days while work remains`,
    }
  }

  if (!hasWork && !hasProgress && idleDays >= 3) {
    return {
      health: 'unengaged',
      momentum: 'flat',
      explanation: 'No tasks, notes, or recent activity yet',
    }
  }

  if (!hasWork && !hasProgress) {
    return {
      health: 'unengaged',
      momentum: 'flat',
      explanation: 'Project exists but meaningful work has not started',
    }
  }

  if (pct >= 90 || (milestoneShare != null && milestoneShare >= 0.9)) {
    return {
      health: 'near_completion',
      momentum,
      explanation: 'Most work and milestones are complete',
    }
  }

  const recent = idleDays <= 7
  const strongCompletion = pct >= 60 && input.doneTasks >= 2
  const goodDocs = input.notesCount >= 2
  if (strongCompletion && recent && (momentum !== 'down' || goodDocs)) {
    return {
      health: 'healthy',
      momentum,
      explanation: 'Consistent momentum with solid completion',
    }
  }

  if (pct >= 20 || (input.doneTasks >= 1 && input.openTasks >= 1) || (recent && input.doneTasks >= 1)) {
    return {
      health: 'active',
      momentum,
      explanation: 'Steady progress with tasks moving',
    }
  }

  if (hasProgress || pct > 0 || input.inProgressCount > 0) {
    return {
      health: 'started',
      momentum,
      explanation: 'Work has begun but progress is still early',
    }
  }

  return {
    health: 'unengaged',
    momentum: 'flat',
    explanation: 'No meaningful progress yet',
  }
}

/** Persist intelligent health directly (DB enum includes these labels). */
export function toPersistedHealthStatus(health: ProjectHealth): HealthStatus {
  return health
}
