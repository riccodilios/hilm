import { describe, expect, it } from 'vitest'
import { resolvePageAccess } from '@/features/workspace-os/lib/page-permissions'

describe('workspace page defaults', () => {
  it('owners and admins read and write everything', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(resolvePageAccess(role, 'team-lead', {})).toEqual({ read: true, write: true })
      expect(resolvePageAccess(role, 'mission-control', {})).toEqual({ read: true, write: true })
    }
  })

  it('members get mission control read only and no team lead inbox', () => {
    expect(resolvePageAccess('member', 'mission-control', {})).toEqual({ read: true, write: false })
    expect(resolvePageAccess('member', 'team-lead', {})).toEqual({ read: false, write: false })
    expect(resolvePageAccess('member', 'tasks', {})).toEqual({ read: true, write: true })
  })

  it('members who lead people get their team lead inbox', () => {
    expect(resolvePageAccess('member', 'team-lead', {}, { leadsPeople: true })).toEqual({ read: true, write: true })
  })

  it('explicit per-member settings win over defaults', () => {
    expect(resolvePageAccess('member', 'team-lead', { 'team-lead': { read: true, write: false } })).toEqual({
      read: true,
      write: false,
    })
  })

  it('viewers read the core pages and never write', () => {
    for (const page of ['home', 'projects', 'tasks', 'team', 'activity', 'reports', 'mission-control'] as const) {
      expect(resolvePageAccess('viewer', page, {})).toEqual({ read: true, write: false })
    }
    for (const page of ['ai', 'org', 'crm', 'profile', 'team-lead'] as const) {
      expect(resolvePageAccess('viewer', page, {}).read).toBe(false)
    }
    expect(resolvePageAccess('viewer', 'tasks', { tasks: { read: true, write: true } })).toEqual({
      read: true,
      write: false,
    })
  })
})
