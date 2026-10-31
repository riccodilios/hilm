import { assertSafeAttachment } from '@/lib/safe-attachment'
import { supabase } from '@/lib/supabase/client'
import type { StorageFileStatus } from '@/types/database'

/**
 * Server-enforced uploads. The database authorizes the target, checks size, type and quota and
 * generates the object key (storage_begin_upload); the browser uploads to that key only; the
 * database then verifies the stored object before the attachment appears (storage_complete_upload).
 */
export type UploadTarget = { entityType: 'task' | 'workspace_task'; entityId: string }

export class UploadRejectedError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>
  constructor(code: string, details: Record<string, unknown> = {}) {
    super(code)
    this.name = 'UploadRejectedError'
    this.code = code
    this.details = details
  }
}

type BeginResult =
  | { ok: true; file_id: string; bucket: string; object_key: string; upload_expires_at: string }
  | { ok: false; code: string; [key: string]: unknown }

type CompleteResult =
  | { ok: true; file_id: string; expires_at: string | null; attachment?: Record<string, unknown>; duplicate?: boolean }
  | { ok: false; code: string; reason?: string }

async function sha256Hex(file: Blob) {
  if (!globalThis.crypto?.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function uploadAttachmentFile(target: UploadTarget, file: File) {
  assertSafeAttachment(file)
  const checksum = await sha256Hex(file).catch(() => null)
  const { data: begun, error: beginError } = await supabase.rpc('storage_begin_upload', {
    p_category: 'task_attachment',
    p_entity_type: target.entityType,
    p_entity_id: target.entityId,
    p_filename: file.name,
    p_mime: file.type || null,
    p_size: file.size,
    p_sha256: checksum,
  })
  if (beginError) throw beginError
  const begin = begun as unknown as BeginResult
  if (!begin.ok) {
    const { code, ...details } = begin
    throw new UploadRejectedError(code, details)
  }

  const { error: uploadError } = await supabase.storage.from(begin.bucket).upload(begin.object_key, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (uploadError) {
    await supabase.rpc('storage_cancel_upload', { p_file_id: begin.file_id })
    throw uploadError
  }

  const { data: completed, error: completeError } = await supabase.rpc('storage_complete_upload', { p_file_id: begin.file_id })
  if (completeError) throw completeError
  const complete = completed as unknown as CompleteResult
  if (!complete.ok) throw new UploadRejectedError(complete.reason ?? complete.code)
  return complete
}

export type FileLifecycle = {
  file_id: string
  status: StorageFileStatus
  expires_at: string | null
  legal_hold: boolean
  purge_after: string | null
}

/** Lifecycle state for attachments, keyed by registry id (rows the caller may see only). */
export async function fileLifecycles(fileIds: Array<string | null | undefined>) {
  const ids = [...new Set(fileIds.filter((id): id is string => Boolean(id)))]
  const map = new Map<string, FileLifecycle>()
  if (!ids.length) return map
  const { data, error } = await supabase
    .from('storage_files')
    .select('id, status, expires_at, legal_hold, purge_after')
    .in('id', ids)
  if (error) return map
  for (const row of (data ?? []) as Array<{ id: string; status: StorageFileStatus; expires_at: string | null; legal_hold: boolean; purge_after: string | null }>) {
    map.set(row.id, { file_id: row.id, status: row.status, expires_at: row.expires_at, legal_hold: row.legal_hold, purge_after: row.purge_after })
  }
  return map
}

export async function keepFileLonger(fileId: string, days: number) {
  const { data, error } = await supabase.rpc('storage_extend_file', { p_file_id: fileId, p_days: days })
  if (error) throw error
  const result = data as unknown as { ok: boolean; code?: string; expires_at?: string | null }
  if (!result.ok) throw new UploadRejectedError(result.code ?? 'failed')
  return result
}

export type RetentionInfo = {
  retention_days: number | null
  legal_hold: boolean
  source: string | null
  platform_default_days: number | null
  quarantine_days: number
  max_days: number
  can_manage: boolean
  /** May keep individual files longer (personal owner; workspace owner/admin). */
  can_extend: boolean
  managed_by_platform: boolean
  audio_policy: string
}

export async function getRetentionInfo(workspaceId?: string | null) {
  const { data, error } = await supabase.rpc('storage_retention_info', { p_workspace_id: workspaceId ?? null })
  if (error) throw error
  return data as unknown as RetentionInfo
}

export async function setRetentionDays(days: number, workspaceId?: string | null) {
  const { data, error } = workspaceId
    ? await supabase.rpc('storage_set_workspace_retention', { p_workspace_id: workspaceId, p_retention_days: days })
    : await supabase.rpc('storage_set_my_retention', { p_retention_days: days })
  if (error) throw error
  const result = data as unknown as { ok: boolean; code?: string }
  if (!result.ok) throw new UploadRejectedError(result.code ?? 'failed', result as Record<string, unknown>)
}
