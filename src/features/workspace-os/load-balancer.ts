import type { WorkspaceMember, WorkspaceTask } from '@/features/workspace-os/api'

export type CapacityLevel = 'low' | 'medium' | 'high' | 'overloaded'

export type MemberLoadProfile = {
  userId: string
  role: string
  openCount: number
  overdueCount: number
  urgentCount: number
  highCount: number
  upcomingDeadlines: number
  estimatedHoursLoad: number
  availableHoursWeek: number
  remainingHours: number
  loadPercent: number
  capacity: CapacityLevel
  skills: string[]
  available: boolean
  completionRate: number
  completedCount: number
}

export type AssigneeRecommendation = {
  userId: string
  score: number
  confidence: number
  reasons: string[]
  workloadImpactHours: number
  expectedCompletionConfidence: number
}

export type AssignmentInsight = {
  profiles: MemberLoadProfile[]
  ranked: AssigneeRecommendation[]
  best: AssigneeRecommendation | null
  alternatives: AssigneeRecommendation[]
}

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: 1,
}

const DEFAULT_WEEKLY_HOURS = 40

function capacityFromLoad(loadPercent: number, openCount: number, overdueCount: number): CapacityLevel {
  if (overdueCount >= 2 || loadPercent >= 100 || openCount >= 10) return 'overloaded'
  if (loadPercent >= 75 || openCount >= 6) return 'high'
  if (loadPercent >= 40 || openCount >= 3) return 'medium'
  return 'low'
}

function weeklyHoursFromAvailability(availability: Record<string, unknown> | null | undefined) {
  const raw = availability?.hoursPerWeek ?? availability?.weekly_hours ?? availability?.capacityHours
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WEEKLY_HOURS
}

function isAvailable(availability: Record<string, unknown> | null | undefined) {
  if (!availability) return true
  return (
    availability.available !== false &&
    availability.status !== 'ooo' &&
    availability.status !== 'unavailable'
  )
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/i)
    .filter((t) => t.length > 1)
}

/** Fast, local Workspace AI assignment capability — no separate service. */
export function analyzeAssignmentCandidates(input: {
  members: WorkspaceMember[]
  tasks: WorkspaceTask[]
  candidateIds?: string[] | null
  settingsByUser?: Map<
    string,
    { skills?: string[] | null; availability?: Record<string, unknown> | null }
  >
  priority?: WorkspaceTask['priority'] | string
  estimatedHours?: number | null
  dueAt?: string | null
  titleHint?: string
}): AssignmentInsight {
  const candidates = input.candidateIds?.length
    ? input.members.filter((m) => input.candidateIds!.includes(m.user_id))
    : input.members

  if (!candidates.length) {
    return { profiles: [], ranked: [], best: null, alternatives: [] }
  }

  const settingsByUser = input.settingsByUser ?? new Map()
  const now = Date.now()
  const week = now + 7 * 24 * 60 * 60 * 1000
  const titleTokens = tokenize(input.titleHint ?? '')
  const effort = Math.max(0, Number(input.estimatedHours) || 0)
  const priorityWeight = PRIORITY_WEIGHT[input.priority ?? 'none'] ?? 1

  const profiles: MemberLoadProfile[] = candidates.map((member) => {
    const settings = settingsByUser.get(member.user_id)
    const availability = settings?.availability ?? {}
    const assigned = input.tasks.filter((task) => task.assignee_id === member.user_id)
    const open = assigned.filter((t) => t.status !== 'done' && t.status !== 'archived')
    const done = assigned.filter((t) => t.status === 'done')
    const overdueCount = open.filter((t) => {
      const due = t.due_at ? new Date(t.due_at).getTime() : NaN
      return Number.isFinite(due) && due < now
    }).length
    const upcomingDeadlines = open.filter((t) => {
      const due = t.due_at ? new Date(t.due_at).getTime() : NaN
      return Number.isFinite(due) && due >= now && due <= week
    }).length
    const estimatedHoursLoad = open.reduce((sum, t) => sum + (Number(t.estimated_hours) || 2), 0)
    const availableHoursWeek = weeklyHoursFromAvailability(availability)
    const remainingHours = Math.max(0, availableHoursWeek - estimatedHoursLoad)
    const loadPercent = Math.min(
      140,
      Math.round((estimatedHoursLoad / Math.max(availableHoursWeek, 1)) * 100),
    )
    const completedCount = done.length
    const completionRate =
      assigned.length === 0 ? 0.7 : completedCount / Math.max(assigned.length, 1)

    return {
      userId: member.user_id,
      role: member.role,
      openCount: open.length,
      overdueCount,
      urgentCount: open.filter((t) => t.priority === 'urgent').length,
      highCount: open.filter((t) => t.priority === 'high').length,
      upcomingDeadlines,
      estimatedHoursLoad,
      availableHoursWeek,
      remainingHours,
      loadPercent,
      capacity: capacityFromLoad(loadPercent, open.length, overdueCount),
      skills: settings?.skills ?? [],
      available: isAvailable(availability),
      completionRate,
      completedCount,
    }
  })

  const ranked: AssigneeRecommendation[] = profiles
    .map((profile) => {
      const reasons: string[] = []
      let score = 100

      score -= profile.openCount * 7
      score -= profile.urgentCount * 10
      score -= profile.highCount * 4
      score -= profile.overdueCount * 18
      score -= profile.upcomingDeadlines * 3
      score -= Math.max(0, profile.loadPercent - 50) * 0.35

      if (profile.available) {
        score += 14
        reasons.push('Available this week')
      } else {
        score -= 35
        reasons.push('Marked unavailable')
      }

      if (profile.overdueCount === 0) {
        score += 10
        reasons.push('No overdue work')
      } else {
        reasons.push(`${profile.overdueCount} overdue task(s)`)
      }

      if (profile.capacity === 'low') {
        score += 16
        reasons.push('Lowest current workload')
      } else if (profile.capacity === 'medium') {
        score += 4
        reasons.push(`${profile.openCount} active tasks`)
      } else if (profile.capacity === 'high') {
        score -= 10
        reasons.push('High current load')
      } else {
        score -= 22
        reasons.push('Overloaded')
      }

      reasons.push(
        `Estimated available capacity: ${Math.round(profile.remainingHours)} hours this week`,
      )

      const matchedSkills = profile.skills.filter((skill) => {
        const tokens = tokenize(skill)
        return tokens.some((tok) => titleTokens.includes(tok) || (input.titleHint ?? '').toLowerCase().includes(tok))
      })
      if (matchedSkills.length) {
        score += matchedSkills.length * 12
        reasons.push(`${matchedSkills.slice(0, 2).join(' and ')} expertise matches this task`)
      }

      if (profile.completionRate >= 0.7 && profile.completedCount >= 2) {
        score += 8
        reasons.push('Similar tasks previously completed successfully')
      }

      if (effort > 0) {
        if (profile.remainingHours >= effort) {
          score += 10
          reasons.push(`Can absorb ~${effort}h estimated effort`)
        } else {
          score -= 12
          reasons.push('Limited remaining capacity for estimated effort')
        }
      }

      if (input.dueAt) {
        const due = new Date(input.dueAt).getTime()
        if (Number.isFinite(due) && due - now < 3 * 24 * 60 * 60 * 1000 && profile.capacity !== 'low') {
          score -= 8
          reasons.push('Tight due date with existing load')
        }
      }

      score += priorityWeight * 2

      const confidence = Math.max(8, Math.min(97, Math.round(score)))
      const expectedCompletionConfidence = Math.max(
        10,
        Math.min(
          95,
          Math.round(
            confidence * 0.55 +
              profile.completionRate * 30 +
              (profile.overdueCount === 0 ? 10 : 0) +
              (profile.remainingHours >= effort ? 8 : -5),
          ),
        ),
      )

      // Prefer positive framing for top reasons
      const orderedReasons = [
        ...reasons.filter((r) => !r.startsWith('Marked') && !r.includes('Overloaded') && !r.includes('High current') && !r.includes('Limited') && !r.includes('Tight')),
        ...reasons.filter((r) => r.startsWith('Marked') || r.includes('Overloaded') || r.includes('High current') || r.includes('Limited') || r.includes('Tight')),
      ].slice(0, 5)

      return {
        userId: profile.userId,
        score,
        confidence,
        reasons: orderedReasons,
        workloadImpactHours: effort || 2,
        expectedCompletionConfidence,
      }
    })
    .sort((a, b) => b.score - a.score)

  return {
    profiles,
    ranked,
    best: ranked[0] ?? null,
    alternatives: ranked.slice(1, 4),
  }
}

/** @deprecated Prefer analyzeAssignmentCandidates — kept for call-site compatibility. */
export function recommendAssignee(
  input: Parameters<typeof analyzeAssignmentCandidates>[0],
): AssigneeRecommendation | null {
  return analyzeAssignmentCandidates(input).best
}

export function buildMemberCapacities(
  members: WorkspaceMember[],
  tasks: WorkspaceTask[],
  settingsByUser: Map<
    string,
    { skills?: string[] | null; availability?: Record<string, unknown> | null }
  > = new Map(),
): MemberLoadProfile[] {
  return analyzeAssignmentCandidates({ members, tasks, settingsByUser }).profiles
}
