import { describe, expect, it } from 'vitest'
import { planRoadmapCompletion } from './advance'

describe('planRoadmapCompletion', () => {
  const items = [
    { id: 'now-1', horizon: 'now' as const, position: 0 },
    { id: 'next-1', horizon: 'next' as const, position: 0 },
    { id: 'next-2', horizon: 'next' as const, position: 1 },
    { id: 'later-1', horizon: 'later' as const, position: 0 },
    { id: 'future-1', horizon: 'future' as const, position: 0 },
  ]

  it('promotes next→now, later→next, future→later when the last now item is completed', () => {
    expect(planRoadmapCompletion(items, 'now-1')).toEqual({
      deleteId: 'now-1',
      moves: [
        { id: 'next-1', horizon: 'now' },
        { id: 'later-1', horizon: 'next' },
        { id: 'future-1', horizon: 'later' },
      ],
    })
  })

  it('does not promote while other now items remain', () => {
    const withTwoNow = [
      { id: 'now-1', horizon: 'now' as const, position: 0 },
      { id: 'now-2', horizon: 'now' as const, position: 1 },
      { id: 'next-1', horizon: 'next' as const, position: 0 },
    ]
    expect(planRoadmapCompletion(withTwoNow, 'now-1')).toEqual({
      deleteId: 'now-1',
      moves: [],
    })
  })

  it('only deletes when completing a non-now item', () => {
    expect(planRoadmapCompletion(items, 'next-2')).toEqual({
      deleteId: 'next-2',
      moves: [],
    })
  })
})
