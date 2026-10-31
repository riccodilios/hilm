import { describe, expect, it } from 'vitest'
import { memberPosition } from '@/features/workspace-os/lib/member-positions'

const t = (key: string, options?: Record<string, unknown>) => {
  if (key === 'workspace.positionHead') return `Head of ${String(options?.department)}`
  if (key === 'workspace.positionLead') return `${String(options?.team)} lead`
  return key.replace('workspace.roles.', '').replace(/^./, (c) => c.toUpperCase())
}

const departments = [
  { id: 'hr', name: 'HR', head_user_id: 'hana' },
  { id: 'eng', name: 'Engineering', head_user_id: null },
]
const teams = [{ name: 'Design', lead_user_id: 'dina' }]

describe('memberPosition', () => {
  it('shows department heads, team leads and home departments', () => {
    expect(memberPosition({ userId: 'hana', role: 'member', departments, teams, homeDepartmentId: 'hr' }, t)).toBe(
      'Head of HR',
    )
    expect(memberPosition({ userId: 'dina', role: 'member', departments, teams, homeDepartmentId: 'eng' }, t)).toBe(
      'Design lead',
    )
    expect(memberPosition({ userId: 'sam', role: 'member', departments, teams, homeDepartmentId: 'eng' }, t)).toBe(
      'Engineering',
    )
  })

  it('prefixes owners and admins and falls back to the role', () => {
    expect(memberPosition({ userId: 'hana', role: 'admin', departments, teams, homeDepartmentId: null }, t)).toBe(
      'Admin · Head of HR',
    )
    expect(memberPosition({ userId: 'boss', role: 'owner', departments, teams, homeDepartmentId: null }, t)).toBe(
      'Owner',
    )
    expect(memberPosition({ userId: 'new', role: 'member', departments, teams, homeDepartmentId: null }, t)).toBe(
      'Member',
    )
  })
})
