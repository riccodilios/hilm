import type { RoadmapHorizon } from '@/types/domain'

export type RoadmapAdvanceItem = {
  id: string
  horizon: RoadmapHorizon
  position: number
}

export type RoadmapAdvancePlan = {
  deleteId: string
  moves: Array<{ id: string; horizon: RoadmapHorizon }>
}

function firstInHorizon(items: RoadmapAdvanceItem[], horizon: RoadmapHorizon) {
  return items
    .filter((item) => item.horizon === horizon)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0]
}

/**
 * Completing a Now item removes it. When Now is empty afterwards, promote
 * the lead Next → Now, Later → Next, and Future → Later (one item each).
 * Completing a non-Now item only removes that item.
 */
export function planRoadmapCompletion(
  items: RoadmapAdvanceItem[],
  completedId: string,
): RoadmapAdvancePlan {
  const completed = items.find((item) => item.id === completedId)
  if (!completed) return { deleteId: completedId, moves: [] }

  const remaining = items.filter((item) => item.id !== completedId)
  const moves: RoadmapAdvancePlan['moves'] = []

  if (completed.horizon === 'now' && !remaining.some((item) => item.horizon === 'now')) {
    const next = firstInHorizon(remaining, 'next')
    const later = firstInHorizon(remaining, 'later')
    const future = firstInHorizon(remaining, 'future')
    if (next) moves.push({ id: next.id, horizon: 'now' })
    if (later) moves.push({ id: later.id, horizon: 'next' })
    if (future) moves.push({ id: future.id, horizon: 'later' })
  }

  return { deleteId: completedId, moves }
}
