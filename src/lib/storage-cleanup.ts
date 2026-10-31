import { supabase } from '@/lib/supabase/client'

const BATCH = 100

/**
 * Removes Storage objects the signed-in user is allowed to delete (Storage policies decide).
 * Best effort: anything left behind is recorded by the database in private.storage_object_deletions
 * when its metadata row is deleted.
 */
export async function removeStorageObjects(bucket: string, paths: Array<string | null | undefined>) {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))]
  for (let i = 0; i < unique.length; i += BATCH) {
    await supabase.storage
      .from(bucket)
      .remove(unique.slice(i, i + BATCH))
      .catch(() => undefined)
  }
}
