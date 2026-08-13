import { describe, expect, it } from 'vitest'
import {
  extractMentionUserIds,
  formatWorkspaceTaskRef,
  matchesWorkspaceTaskRef,
  parseWorkspaceTaskRef,
  plainTextFromMentionContent,
} from '@/features/workspace-os/lib/task-refs'

describe('workspace task refs', () => {
  it('formats and parses short ids', () => {
    expect(formatWorkspaceTaskRef('IMED', 24)).toBe('IMED-24')
    expect(parseWorkspaceTaskRef('imed-24')).toEqual({ key: 'IMED', number: 24 })
    expect(parseWorkspaceTaskRef('not-a-ref')).toBeNull()
  })

  it('matches case-insensitive search', () => {
    expect(matchesWorkspaceTaskRef('imed-24', 'IMED', 24)).toBe(true)
    expect(matchesWorkspaceTaskRef('IMED', 'IMED', 24)).toBe(true)
    expect(matchesWorkspaceTaskRef('other-1', 'IMED', 24)).toBe(false)
  })

  it('extracts mention user ids from stored content', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const content = `Please review @{${id}} before Thursday`
    expect(extractMentionUserIds(content)).toEqual([id])
    expect(plainTextFromMentionContent(content, { [id]: 'Ahmed' })).toBe(
      'Please review @Ahmed before Thursday',
    )
  })
})
