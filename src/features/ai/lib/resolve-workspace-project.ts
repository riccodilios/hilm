import {
  listWorkspaceProjects,
  type WorkspaceProject,
} from '@/features/workspace-os/api'

function normalizeName(value: string) {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function scoreNameMatch(projectName: string, query: string) {
  const name = normalizeName(projectName)
  const q = normalizeName(query)
  if (!q || !name) return 0
  if (name === q) return 100
  if (name.startsWith(q) || q.startsWith(name)) return 80
  if (name.includes(q) || q.includes(name)) return 60
  const nameTokens = new Set(name.split(' ').filter(Boolean))
  const queryTokens = q.split(' ').filter(Boolean)
  const hits = queryTokens.filter((token) => nameTokens.has(token)).length
  if (hits && hits === queryTokens.length) return 70
  if (hits) return 40 + hits * 5
  return 0
}

export type WorkspaceProjectResolveResult =
  | { ok: true; project: WorkspaceProject }
  | {
      ok: false
      reason: string
      candidates?: Array<{ id: string; name: string }>
    }

/**
 * Resolve a workspace project for AI actions.
 * Never invents IDs. Never reads Personal OS projects.
 * Always scoped to the active workspaceId.
 */
export async function resolveWorkspaceProjectForAction(
  workspaceId: string,
  opts?: {
    projectId?: string | null
    projectName?: string | null
    preferProjectId?: string | null
  },
): Promise<WorkspaceProjectResolveResult> {
  const projects = await listWorkspaceProjects(workspaceId)
  if (!projects.length) {
    return {
      ok: false,
      reason:
        'I couldn’t create the task because this workspace has no projects yet. Create a project first, then try again.',
    }
  }

  const findById = (id: string | null | undefined) =>
    id ? projects.find((project) => project.id === id) ?? null : null

  // Prefer explicit name over any ID — models often invent UUIDs or reuse Personal OS IDs.
  const name = opts?.projectName?.trim()
  if (name) {
    const ranked = projects
      .map((project) => ({ project, score: scoreNameMatch(project.name, name) }))
      .filter((row) => row.score >= 40)
      .sort((a, b) => b.score - a.score)

    if (!ranked.length) {
      return {
        ok: false,
        reason: `I couldn’t find a project named “${name}” in this workspace. Would you like me to create that project first?`,
        candidates: projects.slice(0, 8).map((project) => ({ id: project.id, name: project.name })),
      }
    }

    const top = ranked[0]!
    const ties = ranked.filter((row) => row.score === top.score && row.score >= 60)
    if (ties.length > 1) {
      return {
        ok: false,
        reason: `I found multiple projects matching “${name}”. Which one should I use?`,
        candidates: ties.map((row) => ({ id: row.project.id, name: row.project.name })),
      }
    }

    if (top.score >= 60) return { ok: true, project: top.project }

    return {
      ok: false,
      reason: `I couldn’t confidently match “${name}” to a workspace project. Which project should I use?`,
      candidates: ranked.slice(0, 5).map((row) => ({ id: row.project.id, name: row.project.name })),
    }
  }

  // Explicit ID must exist in THIS workspace (rejects Personal OS / invented UUIDs)
  if (opts?.projectId) {
    const exact = findById(opts.projectId)
    if (exact) return { ok: true, project: exact }
  }

  // Conversation focus project (must still belong to this workspace)
  if (opts?.preferProjectId) {
    const preferred = findById(opts.preferProjectId)
    if (preferred) return { ok: true, project: preferred }
  }

  // Explicit invalid ID without a usable name/focus
  if (opts?.projectId) {
    return {
      ok: false,
      reason:
        'I couldn’t create the task because I couldn’t find that project in this workspace. Which project should I use?',
      candidates: projects.slice(0, 8).map((project) => ({ id: project.id, name: project.name })),
    }
  }

  // Safe default only when unambiguous
  if (projects.length === 1) return { ok: true, project: projects[0]! }

  return {
    ok: false,
    reason:
      'Which workspace project should this task belong to? Tell me the project name, or create the project first.',
    candidates: projects.slice(0, 8).map((project) => ({ id: project.id, name: project.name })),
  }
}
