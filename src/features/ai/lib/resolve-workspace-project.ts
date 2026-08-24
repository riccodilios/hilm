import {
  listWorkspaceProjects,
  type WorkspaceProject,
} from '@/features/workspace-os/api'

function normalizeName(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[''`´]/g, '')
    .replace(/[^a-z0-9\u0600-\u06FF\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Strip entity-type words so "Wasl project" / "Wasl app" still match "Wasl". */
function stripEntityNoise(value: string) {
  return normalizeName(value)
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\b(project|projects|app|apps|product|products|workspace|initiative|program|tool)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreNameMatch(projectName: string, query: string) {
  const name = normalizeName(projectName)
  const qRaw = normalizeName(query)
  const q = stripEntityNoise(query) || qRaw
  if (!q || !name) return 0
  if (name === q || name === qRaw) return 100
  if (name.startsWith(q) || q.startsWith(name) || name.startsWith(qRaw) || qRaw.startsWith(name)) {
    return 80
  }
  const nameTokens = new Set(name.split(' ').filter(Boolean))
  const queryTokens = q.split(' ').filter(Boolean)
  const hits = queryTokens.filter((token) => nameTokens.has(token)).length
  if (hits && hits === queryTokens.length) return 70
  if (name.includes(q) || q.includes(name) || name.includes(qRaw) || qRaw.includes(name)) return 55
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
    /** When set, weak includes-only matches against the workspace name are rejected. */
    workspaceName?: string | null
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
    const strong = ranked.filter((row) => row.score >= 70)
    const ties = (strong.length ? strong : ranked.filter((row) => row.score === top.score && row.score >= 55)).filter(
      (row, index, arr) => arr.findIndex((other) => other.project.id === row.project.id) === index,
    )

    if (ties.length > 1 && ties[0]!.score === ties[1]!.score) {
      return {
        ok: false,
        reason: `I found multiple projects matching “${name}”. Which one should I use?`,
        candidates: ties.map((row) => ({ id: row.project.id, name: row.project.name })),
      }
    }

    // Reject weak includes-only hits when the query is just the workspace name
    // and no project shares that exact/prefix name.
    const workspaceName = opts?.workspaceName?.trim()
    if (
      workspaceName &&
      top.score < 70 &&
      stripEntityNoise(name) === stripEntityNoise(workspaceName) &&
      !projects.some((project) => scoreNameMatch(project.name, name) >= 80)
    ) {
      return {
        ok: false,
        reason: `“${name}” is the workspace name. Which project inside this workspace should I use?`,
        candidates: projects.slice(0, 8).map((project) => ({ id: project.id, name: project.name })),
      }
    }

    // Accept strong matches (exact/prefix/token) or a single medium includes match.
    if (top.score >= 70) return { ok: true, project: top.project }
    if (top.score >= 55 && ranked.filter((row) => row.score >= 55).length === 1) {
      return { ok: true, project: top.project }
    }

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
