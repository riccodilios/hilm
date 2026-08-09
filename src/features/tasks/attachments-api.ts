import { assertSafeAttachment, sanitizeAttachmentFilename } from '@/lib/safe-attachment'
import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import type { Tables } from '@/types/database'

export type PersonalAttachment = Tables<'attachments'> & { url?: string | null }

const SIGNED_URL_TTL_SEC = 15 * 60

export async function listTaskAttachments(taskId: string) {
  const { data, error } = await supabase
    .from('attachments')
    .select('*')
    .eq('entity_type', 'task')
    .eq('entity_id', taskId)
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as Tables<'attachments'>[]
  return Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await supabase.storage
        .from('attachments')
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SEC)
      return { ...row, url: signed?.signedUrl ?? null } as PersonalAttachment
    }),
  )
}

export async function uploadTaskAttachment(taskId: string, file: File) {
  assertSafeAttachment(file)
  const userId = await requireUserId()
  const safeName = sanitizeAttachmentFilename(file.name)
  const storage_path = `${userId}/tasks/${taskId}/${Date.now()}_${safeName}`
  const { error: upError } = await supabase.storage.from('attachments').upload(storage_path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (upError) throw upError
  const { data, error } = await supabase
    .from('attachments')
    .insert({
      user_id: userId,
      entity_type: 'task',
      entity_id: taskId,
      storage_path,
      mime: file.type || null,
      filename: file.name,
      byte_size: file.size,
      version: 1,
    } as never)
    .select('*')
    .single()
  if (error) throw error
  return data as Tables<'attachments'>
}

export async function removeTaskAttachment(id: string) {
  const { data, error } = await supabase.from('attachments').select('*').eq('id', id).single()
  if (error) throw error
  const row = data as Tables<'attachments'>
  await supabase.storage.from('attachments').remove([row.storage_path])
  const { error: delError } = await supabase.from('attachments').delete().eq('id', id)
  if (delError) throw delError
}

export async function downloadTaskAttachment(row: PersonalAttachment) {
  const { data, error } = await supabase.storage.from('attachments').download(row.storage_path)
  if (error) throw error
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = row.filename
  a.click()
  URL.revokeObjectURL(url)
}
