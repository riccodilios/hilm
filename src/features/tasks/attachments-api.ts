import { supabase } from '@/lib/supabase/client'
import { fileLifecycles, uploadAttachmentFile, type FileLifecycle } from '@/lib/storage/uploads'
import type { Tables } from '@/types/database'

export type PersonalAttachment = Tables<'attachments'> & { url?: string | null; lifecycle?: FileLifecycle | null }

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
  const lifecycles = await fileLifecycles(rows.map((row) => row.file_id))
  return Promise.all(
    rows.map(async (row) => {
      const lifecycle = row.file_id ? (lifecycles.get(row.file_id) ?? null) : null
      const readable = !lifecycle || lifecycle.status === 'active'
      const { data: signed } = readable
        ? await supabase.storage.from('attachments').createSignedUrl(row.storage_path, SIGNED_URL_TTL_SEC)
        : { data: null }
      return { ...row, url: signed?.signedUrl ?? null, lifecycle } as PersonalAttachment
    }),
  )
}

export async function uploadTaskAttachment(taskId: string, file: File) {
  return uploadAttachmentFile({ entityType: 'task', entityId: taskId }, file)
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
