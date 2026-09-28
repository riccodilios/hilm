/**
 * Central AI runtime configuration.
 * Env vars override defaults so cost controls can change without code edits.
 * Plan quotas stay in `ai_quota_tiers` (DB); this file covers routing + safety rails.
 */

export type AiFeature =
  | 'chat'
  | 'daily_log'
  | 'meeting_transcription'
  | 'meeting_analyze'
  | 'meeting_chunk_summary'

function envBool(name: string, fallback: boolean) {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const value = raw.trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(value)) return false
  if (['1', 'true', 'on', 'yes'].includes(value)) return true
  return fallback
}

function envInt(name: string, fallback: number) {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function envFloat(name: string, fallback: number) {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function envModel(name: string, fallback: string) {
  const raw = process.env[name]?.trim()
  return raw || fallback
}

const DEFAULT_FLASH = 'google/gemini-2.5-flash'

/** Snapshot of knobs used by the AI gateway and feature handlers. */
export function getAiRuntimeConfig() {
  const defaultModel = envModel('OPENROUTER_DEFAULT_MODEL', DEFAULT_FLASH)

  return {
    /** Master kill switch — blocks all AI features. */
    aiEnabled: envBool('AI_ENABLED', true),
    transcriptionEnabled: envBool('TRANSCRIPTION_ENABLED', true),
    analysisEnabled: envBool('ANALYSIS_ENABLED', true),
    /** Soft global daily spend ceiling (USD). 0 = disabled. Enforced in gateway when > 0. */
    maxGlobalDailyCostUsd: envFloat('MAX_GLOBAL_DAILY_AI_COST', 0),

    models: {
      chat: envModel('AI_MODEL_CHAT', defaultModel),
      daily_log: envModel('AI_MODEL_DAILY_LOG', defaultModel),
      meeting_transcription: envModel('AI_MODEL_MEETING_TRANSCRIBE', DEFAULT_FLASH),
      meeting_analyze: envModel('AI_MODEL_MEETING_ANALYZE', defaultModel),
      /** Cheaper/same-class model for hierarchical chunk extraction. */
      meeting_chunk_summary: envModel('AI_MODEL_MEETING_CHUNK', defaultModel),
    } satisfies Record<AiFeature, string>,

    maxTokens: {
      chatPersonal: envInt('AI_MAX_TOKENS_CHAT', 4096),
      chatWorkspace: envInt('AI_MAX_TOKENS_CHAT_WORKSPACE', 8192),
      daily_log: envInt('AI_MAX_TOKENS_DAILY_LOG', 2048),
      meeting_analyze: envInt('AI_MAX_TOKENS_MEETING_ANALYZE', 4096),
      meeting_chunk_summary: envInt('AI_MAX_TOKENS_MEETING_CHUNK', 1536),
    },

    chat: {
      /** Recent messages only — full history is too expensive. */
      maxHistoryMessages: envInt('AI_CHAT_HISTORY_MESSAGES', 10),
      maxHistoryCharsPerMessage: envInt('AI_CHAT_HISTORY_CHARS', 2_000),
    },

    meeting: {
      /** Below this transcript size, run a single analysis pass. */
      directAnalysisMaxChars: envInt('AI_MEETING_DIRECT_ANALYSIS_CHARS', 48_000),
      /** Chunk size for hierarchical extraction on long meetings. */
      hierarchicalChunkChars: envInt('AI_MEETING_HIERARCHICAL_CHUNK_CHARS', 36_000),
      /** Prior transcript lines for STT continuity (not language locking). */
      previousContextLines: envInt('AI_MEETING_PREVIOUS_LINES', 4),
      /** Provider retries for transient STT/analysis failures only. */
      providerMaxRetries: envInt('AI_MEETING_PROVIDER_RETRIES', 1),
    },

    retry: {
      maxAttempts: envInt('AI_PROVIDER_MAX_RETRIES', 2),
      baseDelayMs: envInt('AI_PROVIDER_RETRY_BASE_MS', 500),
    },
  }
}

export type AiRuntimeConfig = ReturnType<typeof getAiRuntimeConfig>

export function featureDisabledMessage(feature: AiFeature): string {
  switch (feature) {
    case 'meeting_transcription':
      return 'Meeting transcription is temporarily disabled. Please try again later.'
    case 'meeting_analyze':
    case 'meeting_chunk_summary':
      return 'Meeting AI analysis is temporarily disabled. Your transcript is still saved.'
    case 'daily_log':
      return 'Daily log generation is temporarily disabled. Please try again later.'
    case 'chat':
    default:
      return 'AI is temporarily disabled. Please try again later.'
  }
}

export function resolveFeatureModel(feature: AiFeature, config = getAiRuntimeConfig()): string {
  return config.models[feature]
}

/**
 * Overlay DB kill switches from `ai_runtime_controls` (migration 0028) onto env config.
 * Env vars still win when explicitly set; DB is for ops toggles without redeploy.
 * Missing table/function is non-fatal (pre-migration).
 */
export async function mergeDbRuntimeControls(
  config: AiRuntimeConfig,
  fetchControls: () => Promise<{
    ai_enabled?: boolean
    transcription_enabled?: boolean
    analysis_enabled?: boolean
    max_global_daily_cost_usd?: number | null
  } | null>,
): Promise<AiRuntimeConfig> {
  try {
    const row = await fetchControls()
    if (!row) return config
    return {
      ...config,
      // Explicit env overrides remain authoritative when set.
      aiEnabled:
        process.env.AI_ENABLED != null && process.env.AI_ENABLED.trim() !== ''
          ? config.aiEnabled
          : row.ai_enabled !== false,
      transcriptionEnabled:
        process.env.TRANSCRIPTION_ENABLED != null && process.env.TRANSCRIPTION_ENABLED.trim() !== ''
          ? config.transcriptionEnabled
          : row.transcription_enabled !== false,
      analysisEnabled:
        process.env.ANALYSIS_ENABLED != null && process.env.ANALYSIS_ENABLED.trim() !== ''
          ? config.analysisEnabled
          : row.analysis_enabled !== false,
      maxGlobalDailyCostUsd:
        process.env.MAX_GLOBAL_DAILY_AI_COST != null && process.env.MAX_GLOBAL_DAILY_AI_COST.trim() !== ''
          ? config.maxGlobalDailyCostUsd
          : typeof row.max_global_daily_cost_usd === 'number'
            ? row.max_global_daily_cost_usd
            : config.maxGlobalDailyCostUsd,
    }
  } catch {
    return config
  }
}
