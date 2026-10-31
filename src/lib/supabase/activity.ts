import { supabase } from '@/lib/supabase/client'

/**
 * The signed-in user's id, from the local session (refreshed by supabase-js when it expires).
 * Not getUser(): that is a round trip to Auth under the client-wide auth lock, so parallel data
 * loads would queue behind each other. Row level security still checks the token on every query.
 */
export async function requireUserId() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (error || !userId) throw new Error('Not authenticated')
  return userId
}
