import { describe, expect, it } from 'vitest'
import {
  applyCreatedProjectToFollowingActions,
  rewriteActionsForConversationFocus,
} from '@/features/ai/lib/rewrite-actions'

describe('rewriteActionsForConversationFocus', () => {
  const focus = {
    lastCreatedTaskId: '11111111-1111-1111-1111-111111111111',
    lastModifiedTaskId: '11111111-1111-1111-1111-111111111111',
    lastTaskTitle: 'Prepare Wasl documentation',
  }

  it('rewrites create to update for title/description follow-ups', () => {
    const next = rewriteActionsForConversationFocus(
      [{ type: 'task.create', title: 'Wasl docs', description: 'More detail' }],
      { userMessage: 'Make the title shorter and put more details in the description.', focus },
    )
    expect(next[0]?.type).toBe('task.update')
    expect(next[0]?.taskId).toBe(focus.lastCreatedTaskId)
  })

  it('rewrites create to schedule for due-date follow-ups', () => {
    const next = rewriteActionsForConversationFocus(
      [{ type: 'task.create', dueAt: '2026-08-11T10:30:00' }],
      { userMessage: 'Make it due Monday at 10:30.', focus },
    )
    expect(next[0]?.type).toBe('task.schedule')
    expect(next[0]?.taskId).toBe(focus.lastCreatedTaskId)
  })

  it('keeps explicit create when user asks for a new task', () => {
    const next = rewriteActionsForConversationFocus(
      [{ type: 'task.create', title: 'Brand new thing' }],
      { userMessage: 'Create a new task called Brand new thing', focus },
    )
    expect(next[0]?.type).toBe('task.create')
  })

  it('fills missing taskId on update from focus', () => {
    const next = rewriteActionsForConversationFocus(
      [{ type: 'task.update', taskId: 'TODO', title: 'Short' }],
      { userMessage: 'Rename it to Short', focus },
    )
    expect(next[0]?.taskId).toBe(focus.lastCreatedTaskId)
  })

  it('reuses focused workspace project when adding another task for it', () => {
    const projectFocus = {
      ...focus,
      lastReferencedProjectId: '22222222-2222-2222-2222-222222222222',
      lastReferencedProjectName: 'Wasl',
    }
    const next = rewriteActionsForConversationFocus(
      [{ type: 'task.create', title: 'Follow up' }],
      { userMessage: 'Add another task for it called Follow up', focus: projectFocus },
    )
    expect(next[0]?.type).toBe('task.create')
    expect(next[0]?.projectId).toBe(projectFocus.lastReferencedProjectId)
    expect(next[0]?.projectName).toBe('Wasl')
  })

  it('does not override an explicit projectName with focus project', () => {
    const projectFocus = {
      ...focus,
      lastReferencedProjectId: '22222222-2222-2222-2222-222222222222',
      lastReferencedProjectName: 'Wasl',
    }
    const next = rewriteActionsForConversationFocus(
      [{ type: 'task.create', title: 'Acme task', projectName: 'Acme' }],
      { userMessage: 'Create a task for Acme', focus: projectFocus },
    )
    expect(next[0]?.projectName).toBe('Acme')
    expect(next[0]?.projectId).toBeUndefined()
  })

  it('injects focus project into task.create_many when name matches', () => {
    const projectFocus = {
      lastReferencedProjectId: '22222222-2222-2222-2222-222222222222',
      lastReferencedProjectName: 'IMED',
    }
    const next = rewriteActionsForConversationFocus(
      [
        {
          type: 'task.create_many',
          projectName: 'IMED',
          items: [{ title: 'A' }, { title: 'B' }],
        },
      ],
      { userMessage: 'Now add these tasks to it', focus: projectFocus },
    )
    expect(next[0]?.projectId).toBe(projectFocus.lastReferencedProjectId)
    expect(next[0]?.projectName).toBe('IMED')
  })

  it('stamps created project id onto following task actions', () => {
    const actions = [
      { type: 'project.create', name: 'IMED' },
      {
        type: 'task.create_many',
        projectName: 'IMED',
        items: [{ title: 'Kickoff' }],
      },
    ]
    applyCreatedProjectToFollowingActions(
      actions,
      { projectId: '33333333-3333-3333-3333-333333333333', projectName: 'IMED' },
      0,
    )
    expect(actions[1]?.projectId).toBe('33333333-3333-3333-3333-333333333333')
    expect(actions[1]?.projectName).toBe('IMED')
  })
})
