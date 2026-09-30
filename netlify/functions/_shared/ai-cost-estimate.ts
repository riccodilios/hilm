/**
 * Cost estimation helpers for capacity planning.
 * Constants come from provider-reported usage in benchmarks/meeting-ai (google/gemini-2.5-flash
 * via OpenRouter). These are estimates for architecture decisions — not invoices; the ledger
 * stores the provider-reported cost per call.
 */

export type MeetingCostBreakdown = {
  durationMinutes: number
  segmentSeconds: number
  segmentCount: number
  /** STT audio input tokens (25 tok/s of audio actually sent). */
  transcriptionAudioTokens: number
  /** Text prompt tokens across all parts. */
  transcriptionPromptTokens: number
  transcriptionOutputTokens: number
  transcriptionTokens: number
  transcriptionEstimatedUsd: number
  /** Direct single-pass analysis (~chars/4) */
  analysisDirectTokens: number
  analysisDirectEstimatedUsd: number
  /** Hierarchical: N chunk passes + 1 merge */
  analysisHierarchicalTokens: number
  analysisHierarchicalEstimatedUsd: number
  totalTranscriptionPlusDirectUsd: number
  totalTranscriptionPlusHierarchicalUsd: number
}

/** OpenRouter list prices for google/gemini-2.5-flash (USD / 1M tokens), matching reported cost. */
export const COST_RATES = {
  audioIn: 1.0,
  textIn: 0.3,
  out: 2.5,
} as const

export const DEFAULT_SEGMENT_SECONDS = 90
/** ~chars of transcript per meeting minute (dense two-speaker speech measured 780–1,060). */
export const CHARS_PER_MEETING_MINUTE = 1_000
/** Provider-reported: prompt_tokens_details.audio_tokens = 25 per second of audio. */
export const AUDIO_TOKENS_PER_SECOND = 25
/** Measured text prompt per part (instructions + hints + roster + previous lines). */
export const PROMPT_TOKENS_PER_SEGMENT = 830
/** Measured STT output per audio minute in the compact format (348–384); rounded up. */
export const STT_OUTPUT_TOKENS_PER_MINUTE = 400
export const ANALYSIS_OUTPUT_TOKENS = 1_000
const ANALYSIS_PROMPT_TOKENS = 600

function usd(tokens: { audio?: number; text?: number; out?: number }) {
  return (
    ((tokens.audio ?? 0) * COST_RATES.audioIn + (tokens.text ?? 0) * COST_RATES.textIn + (tokens.out ?? 0) * COST_RATES.out) /
    1_000_000
  )
}

/**
 * Estimate provider cost for a representative meeting length.
 * `sentAudioRatio` is the share of audio still sent after silence trimming (1 = none trimmed).
 */
export function estimateMeetingPipelineCost(input: {
  durationMinutes: number
  segmentSeconds?: number
  directAnalysisMaxChars?: number
  hierarchicalChunkChars?: number
  sentAudioRatio?: number
}): MeetingCostBreakdown {
  const segmentSeconds = input.segmentSeconds ?? DEFAULT_SEGMENT_SECONDS
  const directMax = input.directAnalysisMaxChars ?? 48_000
  const chunkChars = input.hierarchicalChunkChars ?? 36_000
  const sentRatio = Math.min(1, Math.max(0, input.sentAudioRatio ?? 1))
  const durationMinutes = Math.max(0, input.durationMinutes)
  const durationSeconds = durationMinutes * 60
  const segmentCount = Math.max(1, Math.ceil(durationSeconds / segmentSeconds))

  const transcriptionAudioTokens = Math.ceil(durationSeconds * sentRatio * AUDIO_TOKENS_PER_SECOND)
  const transcriptionPromptTokens = segmentCount * PROMPT_TOKENS_PER_SEGMENT
  const transcriptionOutputTokens = Math.ceil(durationMinutes * STT_OUTPUT_TOKENS_PER_MINUTE)
  const transcriptionEstimatedUsd = usd({
    audio: transcriptionAudioTokens,
    text: transcriptionPromptTokens,
    out: transcriptionOutputTokens,
  })

  const transcriptChars = Math.round(durationMinutes * CHARS_PER_MEETING_MINUTE)
  const directIn = Math.ceil(transcriptChars / 4) + ANALYSIS_PROMPT_TOKENS
  const analysisDirectTokens = directIn + ANALYSIS_OUTPUT_TOKENS
  const analysisDirectEstimatedUsd = usd({ text: directIn, out: ANALYSIS_OUTPUT_TOKENS })

  const chunkCount = Math.max(1, Math.ceil(transcriptChars / chunkChars))
  const useHierarchical = transcriptChars > directMax
  const hierarchicalPasses = useHierarchical ? chunkCount + 1 : 1
  const passIn = Math.ceil(Math.min(transcriptChars, chunkChars) / 4) + ANALYSIS_PROMPT_TOKENS
  const analysisHierarchicalTokens = hierarchicalPasses * (passIn + ANALYSIS_OUTPUT_TOKENS)
  const analysisHierarchicalEstimatedUsd = usd({
    text: hierarchicalPasses * passIn,
    out: hierarchicalPasses * ANALYSIS_OUTPUT_TOKENS,
  })

  return {
    durationMinutes,
    segmentSeconds,
    segmentCount,
    transcriptionAudioTokens,
    transcriptionPromptTokens,
    transcriptionOutputTokens,
    transcriptionTokens: transcriptionAudioTokens + transcriptionPromptTokens + transcriptionOutputTokens,
    transcriptionEstimatedUsd,
    analysisDirectTokens,
    analysisDirectEstimatedUsd,
    analysisHierarchicalTokens,
    analysisHierarchicalEstimatedUsd,
    totalTranscriptionPlusDirectUsd: transcriptionEstimatedUsd + analysisDirectEstimatedUsd,
    totalTranscriptionPlusHierarchicalUsd:
      transcriptionEstimatedUsd +
      (useHierarchical ? analysisHierarchicalEstimatedUsd : analysisDirectEstimatedUsd),
  }
}

export function estimateCostTable(durations = [15, 30, 60, 120]) {
  return durations.map((durationMinutes) => estimateMeetingPipelineCost({ durationMinutes }))
}

/** Per-audio-minute STT usage measured by the benchmark harness (`sttPerAudioMinute`). */
export type MeasuredPerMinute = { promptTokens: number; completionTokens: number; totalTokens: number }

/** Linear projection of measured per-minute STT usage to a meeting length. */
export function projectSttUsage(perMinute: MeasuredPerMinute, minutes: number) {
  return {
    minutes,
    promptTokens: Math.round(perMinute.promptTokens * minutes),
    completionTokens: Math.round(perMinute.completionTokens * minutes),
    totalTokens: Math.round(perMinute.totalTokens * minutes),
  }
}
