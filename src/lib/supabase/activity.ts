import { supabase } from '@/lib/supabase/client'

export async function requireUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Not authenticated')
  return user.id
}
