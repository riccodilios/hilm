/**
 * Moves (mode "transfer") or copies (mode "copy") a personal project into a workspace. The database
 * does the move or copy and every permission and confirmation check (transfer_project_to_workspace,
 * copy_project_to_workspace); this function then copies the stored files to their workspace keys
 * with the caller's own token and finalizes them. A later call with { transferId } retries files
 * that could not be copied.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { aiCorsHeaders, aiJson } from './_shared/ai-guard'
import { instrumented } from './_shared/ops/instrument.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COPY_CONCURRENCY = 4

type FileMove = { id: string; bucket: string; from: string; to: string }
type Body = { mode?: string; projectId?: string; workspaceId?: string; confirmation?: string; transferId?: string }

const MESSAGES: Record<string, string> = {
  not_found: 'This project no longer exists in your Personal OS.',
  forbidden: 'You can’t add projects and tasks in that workspace.',
  confirmation_mismatch: 'The confirmation text does not match.',
  already_transferred: 'This project is already in that workspace.',
  meeting_in_progress: 'A meeting in this project is still recording or processing. Try again when it is ready.',
  storage_quota_exceeded: 'The workspace does not have enough storage for this project’s files.',
  already_copied: 'This project already has a copy in Workspace OS.',
}

async function copyOne(client: SupabaseClient, file: FileMove) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await client.storage.from(file.bucket).copy(file.from, file.to)
    if (!error) return true
    // A copy left by an earlier attempt is as good as a new one.
    if (/exist|duplicate/i.test(error.message)) return true
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
  }
  return false
}

async function copyFiles(client: SupabaseClient, files: FileMove[]) {
  const queue = [...files]
  await Promise.all(
    Array.from({ length: Math.min(COPY_CONCURRENCY, queue.length) }, async () => {
      for (let file = queue.shift(); file; file = queue.shift()) await copyOne(client, file)
    }),
  )
}

async function finalize(client: SupabaseClient, transferId: string) {
  const { data, error } = await client.rpc('finalize_project_transfer', { p_transfer_id: transferId })
  if (error) throw new Error(error.message)
  const result = (data ?? {}) as { ok?: boolean; pending?: FileMove[] }
  return result.pending ?? []
}

async function handler(request: Request) {
  const json = (data: unknown, status = 200) => aiJson(data, status, request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: aiCorsHeaders(request) })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Missing authorization token' }, 401)
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) return json({ error: 'Server is not configured' }, 500)

    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const body = (await request.json().catch(() => ({}))) as Body

    if (body.transferId !== undefined) {
      if (!UUID.test(String(body.transferId))) return json({ error: 'Invalid transfer' }, 400)
      let pending = await finalize(client, body.transferId)
      if (pending.length) {
        await copyFiles(client, pending)
        pending = await finalize(client, body.transferId)
      }
      return json({ ok: true, transferId: body.transferId, pendingFiles: pending.length })
    }

    const mode = body.mode === 'copy' ? 'copy' : 'transfer'
    const projectId = String(body.projectId ?? '')
    const workspaceId = String(body.workspaceId ?? '')
    const confirmation = String(body.confirmation ?? '').slice(0, 500)
    if (!UUID.test(projectId) || !UUID.test(workspaceId)) return json({ error: 'Choose a project and a workspace' }, 400)
    if (mode === 'transfer' && !confirmation.trim()) {
      return json({ error: MESSAGES.confirmation_mismatch, code: 'confirmation_mismatch' }, 400)
    }

    const { data, error } =
      mode === 'copy'
        ? await client.rpc('copy_project_to_workspace', { p_project_id: projectId, p_workspace_id: workspaceId })
        : await client.rpc('transfer_project_to_workspace', {
            p_project_id: projectId,
            p_workspace_id: workspaceId,
            p_confirmation: confirmation,
          })
    const failed = mode === 'copy' ? 'The copy failed. Nothing was changed.' : 'The transfer failed. Nothing was changed.'
    if (error) return json({ error: failed }, 500)
    const result = (data ?? {}) as {
      ok?: boolean
      code?: string
      transfer_id?: string
      project_id?: string
      counts?: Record<string, number>
      files?: FileMove[]
    }
    if (!result.ok || !result.transfer_id) {
      const code = result.code ?? 'failed'
      return json({ error: MESSAGES[code] ?? failed, code }, code === 'not_found' ? 404 : 409)
    }

    let pendingFiles = 0
    if (result.files?.length) {
      await copyFiles(client, result.files)
      pendingFiles = (await finalize(client, result.transfer_id).catch(() => result.files ?? [])).length
    }

    return json({
      ok: true,
      transferId: result.transfer_id,
      mode,
      workspaceId,
      projectId: result.project_id ?? projectId,
      counts: result.counts ?? {},
      pendingFiles,
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'The transfer failed' }, 500)
  }
}

export default instrumented('project-transfer', handler)
