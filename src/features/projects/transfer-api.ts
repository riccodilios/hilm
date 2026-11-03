import { supabase } from '@/lib/supabase/client'
import { getAppUrl, getSupabaseAnonKey } from '@/lib/env'

export type TransferTarget = { id: string; name: string; color: string | null; logo_url: string | null }

export type TransferResult = {
  ok: true
  transferId: string
  workspaceId: string
  /** The workspace project: the same id after a transfer, a new id for a copy. */
  projectId: string
  counts: Record<string, number>
  pendingFiles: number
}

export type ProjectCopy = { personalProjectId: string; workspaceId: string; workspaceProjectId: string; workspaceName: string }

export const transferKeys = {
  targets: ['projects', 'transfer-targets'] as const,
  copies: ['projects', 'workspace-copies'] as const,
}

/** The phrase the user types to confirm; the server compares it ignoring case and extra spaces. */
export function transferPhrase(projectName: string) {
  return `transfer ${projectName} to workspace os`
}

export function matchesTransferPhrase(input: string, projectName: string) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
  return normalize(input) === normalize(transferPhrase(projectName))
}

function endpoint() {
  const local = (url: string) => /localhost|127\.0\.0\.1/i.test(url)
  if (typeof window !== 'undefined' && !local(window.location.origin)) return `${window.location.origin}/api/project-transfer`
  const app = getAppUrl()
  return `${(app || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')}/api/project-transfer`
}

export async function listTransferTargets(): Promise<TransferTarget[]> {
  const { data, error } = await supabase.rpc('project_transfer_targets')
  if (error) throw error
  return Array.isArray(data) ? (data as unknown as TransferTarget[]) : []
}

async function post(body: Record<string, unknown>) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: getSupabaseAnonKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || payload.ok !== true) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'The transfer failed')
  }
  return payload
}

/** Personal projects that already have their one workspace copy. */
export async function listProjectCopies(): Promise<ProjectCopy[]> {
  const { data, error } = await supabase
    .from('project_workspace_copies')
    .select('personal_project_id, workspace_id, workspace_project_id, workspaces(name)')
  if (error) throw error
  return ((data ?? []) as unknown as Array<{
    personal_project_id: string
    workspace_id: string
    workspace_project_id: string
    workspaces: { name: string } | null
  }>).map((row) => ({
    personalProjectId: row.personal_project_id,
    workspaceId: row.workspace_id,
    workspaceProjectId: row.workspace_project_id,
    workspaceName: row.workspaces?.name ?? '',
  }))
}

export function copyProjectToWorkspace(input: { projectId: string; workspaceId: string }) {
  return run({ mode: 'copy', ...input })
}

export function transferProjectToWorkspace(input: { projectId: string; workspaceId: string; confirmation: string }) {
  return run({ mode: 'transfer', ...input })
}

async function run(input: Record<string, unknown>): Promise<TransferResult> {
  const result = (await post(input)) as unknown as TransferResult
  if (result.pendingFiles > 0) {
    // One more pass for files whose copy did not finish the first time.
    const retry = await post({ transferId: result.transferId }).catch(() => null)
    if (retry && typeof retry.pendingFiles === 'number') result.pendingFiles = retry.pendingFiles
  }
  return result
}
