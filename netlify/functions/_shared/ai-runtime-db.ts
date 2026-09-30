import type { SupabaseClient } from '@supabase/supabase-js'
import { getAiRuntimeConfig, mergeDbRuntimeControls, type AiRuntimeConfig } from './ai-config'

/** Load effective AI runtime config (env + optional DB kill switches). */
export async function loadEffectiveAiConfig(client: SupabaseClient): Promise<AiRuntimeConfig> {
  const base = getAiRuntimeConfig()
  return mergeDbRuntimeControls(base, async () => {
    const { data, error } = await client.rpc('get_ai_runtime_controls')
    if (error || !data || typeof data !== 'object') return null
    return data as {
      ai_enabled?: boolean
      transcription_enabled?: boolean
      analysis_enabled?: boolean
    }
  })
}
