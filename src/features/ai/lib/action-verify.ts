import { getTask } from '@/features/tasks/api'
import type { ActionResult } from '@/features/ai/registry/types'

type VerifyCreateInput = {
  os: 'personal' | 'workspace'
  workspaceId?: string
  taskId: string
  expected: {
    title: string
    projectId?: string | null
    userId?: string | null
  }
}

/**
 * Re-read the created task from the database and confirm it matches the request.
 * Success claims must only happen after this returns ok.
 */
export async function verifyCreatedTask(input: VerifyCreateInput): Promise<ActionResult> {
  const titleWanted = input.expected.title.trim().toLowerCase()
  try {
    if (input.os === 'workspace') {
      if (!input.workspaceId) {
        return {
          ok: false,
          summary: 'Created task could not be verified (missing workspace).',
          code: 'verify_failed',
          verified: false,
        }
      }
      // Dynamic import keeps Personal OS free of workspace-os static imports.
      const { getWorkspaceTask } = await import('@/features/workspace-os/api')
      const task = await getWorkspaceTask(input.workspaceId, input.taskId)
      if (!task?.id) {
        return {
          ok: false,
          summary: 'Task insert did not persist — nothing was created.',
          code: 'verify_missing',
          verified: false,
        }
      }
      if (task.title.trim().toLowerCase() !== titleWanted) {
        return {
          ok: false,
          summary: `Created task title mismatch (expected “${input.expected.title}”).`,
          code: 'verify_mismatch',
          verified: false,
          entities: [{ type: 'task', id: task.id }],
        }
      }
      if (input.expected.projectId && task.project_id !== input.expected.projectId) {
        return {
          ok: false,
          summary: 'Created task landed in the wrong project.',
          code: 'verify_wrong_project',
          verified: false,
          entities: [{ type: 'task', id: task.id }],
        }
      }
      return {
        ok: true,
        summary: `Verified task ${task.id}`,
        verified: true,
        entities: [{ type: 'task', id: task.id }],
        data: task,
      }
    }

    const task = await getTask(input.taskId)
    if (!task?.id) {
      return {
        ok: false,
        summary: 'Task insert did not persist — nothing was created.',
        code: 'verify_missing',
        verified: false,
      }
    }
    if (input.expected.userId && task.user_id && task.user_id !== input.expected.userId) {
      return {
        ok: false,
        summary: 'Created task does not belong to the current user.',
        code: 'verify_wrong_user',
        verified: false,
        entities: [{ type: 'task', id: task.id }],
      }
    }
    if (task.title.trim().toLowerCase() !== titleWanted) {
      return {
        ok: false,
        summary: `Created task title mismatch (expected “${input.expected.title}”).`,
        code: 'verify_mismatch',
        verified: false,
        entities: [{ type: 'task', id: task.id }],
      }
    }
    if (input.expected.projectId && task.project_id !== input.expected.projectId) {
      return {
        ok: false,
        summary: 'Created task landed in the wrong project.',
        code: 'verify_wrong_project',
        verified: false,
        entities: [{ type: 'task', id: task.id }],
      }
    }
    return {
      ok: true,
      summary: `Verified task ${task.id}`,
      verified: true,
      entities: [{ type: 'task', id: task.id }],
      data: task,
    }
  } catch (error) {
    return {
      ok: false,
      summary: error instanceof Error ? error.message : 'Could not verify created task',
      code: 'verify_error',
      verified: false,
    }
  }
}
