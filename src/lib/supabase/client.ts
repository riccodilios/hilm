import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/env'

const url = getSupabaseUrl()
const anonKey = getSupabaseAnonKey()

if (!url || !anonKey) {
  console.warn(
    'Missing Supabase URL or anon/publishable key. Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (or NEXT_PUBLIC_* equivalents).',
  )
}

export const supabase = createClient<Database>(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: localStorage,
    },
  },
)

export function isSupabaseConfigured() {
  return Boolean(url && anonKey && !url.includes('your-project') && anonKey !== 'your-anon-key')
}
