import { describe, expect, it } from 'vitest'
import { promptForAiCode, recommendPlan } from '@/shared/billing/recommend'

describe('upgrade recommendations', () => {
  it('a Free user upgrading Personal OS sees Personal Pro', () => {
    expect(recommendPlan({ reason: 'personal_upgrade', personalPlan: 'free' }).target).toBe('pro')
  })

  it('a Pro user creating a workspace sees Team', () => {
    expect(recommendPlan({ reason: 'workspace_create', personalPlan: 'pro', workspacePlan: null }).target).toBe('team')
  })

  it('a Team owner creating a second workspace sees Team Pro', () => {
    expect(recommendPlan({ reason: 'workspace_create', personalPlan: 'free', workspacePlan: 'team' }).target).toBe('team_pro')
  })

  it('the eleventh project explains the limit; owners of Team may move to Team Pro for more workspaces', () => {
    expect(recommendPlan({ reason: 'workspace_project_limit', personalPlan: 'pro', workspacePlan: 'team', isBillingOwner: true }).target).toBe('team_pro')
    const member = recommendPlan({ reason: 'workspace_project_limit', personalPlan: 'free', workspacePlan: 'team', isBillingOwner: false })
    expect(member.target).toBeNull()
    expect(member.note).toBe('ask_owner')
  })

  it('a member at the workspace AI allowance is never offered a personal plan', () => {
    for (const personalPlan of ['free', 'pro'] as const) {
      const rec = recommendPlan({ reason: 'workspace_ai_limit', personalPlan, workspacePlan: 'team', isBillingOwner: false })
      expect(rec.scope).toBe('workspace')
      expect(rec.target).toBeNull()
      expect(rec.note).toBe('owner_notified')
    }
  })

  it('a Free user at the personal AI allowance sees Personal Pro, a Pro user is told there are no top-ups', () => {
    expect(recommendPlan({ reason: 'personal_ai_limit', personalPlan: 'free' }).target).toBe('pro')
    const pro = recommendPlan({ reason: 'personal_ai_limit', personalPlan: 'pro', workspacePlan: 'team' })
    expect(pro.target).toBeNull()
    expect(pro.note).toBe('no_topups')
  })

  it('never recommends a workspace plan for a personal limit', () => {
    for (const reason of ['personal_upgrade', 'personal_ai_limit'] as const) {
      for (const personalPlan of ['free', 'pro'] as const) {
        const rec = recommendPlan({ reason, personalPlan, workspacePlan: 'team', isBillingOwner: true })
        expect(rec.scope).toBe('personal')
        expect(['team', 'team_pro']).not.toContain(rec.target)
      }
    }
  })

  it('maps guard codes by scope', () => {
    expect(promptForAiCode('daily_token_limit', 'workspace')).toBe('workspace_ai_limit')
    expect(promptForAiCode('daily_token_limit', 'personal')).toBe('personal_ai_limit')
    expect(promptForAiCode('workspace_subscription_inactive', 'workspace')).toBe('workspace_inactive')
    expect(promptForAiCode('rate_limited', 'workspace')).toBeNull()
    expect(promptForAiCode('member_daily_limit', 'workspace')).toBeNull()
  })
})
