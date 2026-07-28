import { supabase } from '@/lib/supabase/client'

/** Ensures profile + settings (+ Inbox project) exist after first verified login. */
export async function ensureUserBootstrap() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw error ?? new Error('Not authenticated')

  const displayName =
    (user.user_metadata?.display_name as string | undefined) ||
    user.email?.split('@')[0] ||
    'User'

  const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!profile) {
    await supabase.from('profiles').upsert({
      id: user.id,
      display_name: displayName,
    })
  }

  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!settings) {
    await supabase.from('user_settings').upsert({ user_id: user.id })
  }

  const { data: projects } = await supabase
    .from('projects')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
  if (!projects?.length) {
    await supabase.from('projects').insert({
      user_id: user.id,
      name: 'Inbox',
      description: 'Default project for uncategorized work',
      icon: 'inbox',
      color: '#a1a1aa',
    })
  }

  return user
}
