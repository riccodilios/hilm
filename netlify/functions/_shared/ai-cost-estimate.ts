/**
 * Cost estimation helpers for capacity planning.
 * Uses the same bookkeeping rates as `ai_model_pricing` / meeting audio row.
 * These are estimates for architecture decisions — not invoices.
 */

export type MeetingCostBreakdown = {
  durationMinutes: number
  segmentSeconds: number
  segmentCount: number
  /** STT audio input tokens (~32 tok/s) */
  transcriptionAudioTokens: number
  /** Rough prompt overhead per segment */
  transcriptionPromptTokens: number
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

/** Bookkeeping rates (USD / 1M tokens) aligned with migration seeds. */
export const COST_RATES = {
  flashIn: 0.15,
  flashOut: 0.6,
  /** Meeting audio bookkeeping row from 0026 */
  audioIn: 1.0,
  audioOut: 0.6,
} as const

export const DEFAULT_SEGMENT_SECONDS = 90
/** ~chars of transcript per meeting minute (mixed AR/EN speech, rough). */
export const CHARS_PER_MEETING_MINUTE = 900
export const AUDIO_TOKENS_PER_SECOND = 32
export const PROMPT_TOKENS_PER_SEGMENT = 900
export const ANALYSIS_OUTPUT_TOKENS = 1_200

function usdFromTokens(inputTokens: number, outputTokens: number, inRate: number, outRate: number) {
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate
}

/**
 * Estimate provider cost for a representative meeting length.
 * STT dominates; analysis is secondary except for very long transcripts.
 */
export function estimateMeetingPipelineCost(input: {
  durationMinutes: number
  segmentSeconds?: number
  directAnalysisMaxChars?: number
  hierarchicalChunkChars?: number
}): MeetingCostBreakdown {
  const segmentSeconds = input.segmentSeconds ?? DEFAULT_SEGMENT_SECONDS
  const directMax = input.directAnalysisMaxChars ?? 48_000
  const chunkChars = input.hierarchicalChunkChars ?? 36_000
  const durationMinutes = Math.max(0, input.durationMinutes)
  const durationSeconds = durationMinutes * 60
  const segmentCount = Math.max(1, Math.ceil(durationSeconds / segmentSeconds))

  const transcriptionAudioTokens = Math.ceil(durationSeconds * AUDIO_TOKENS_PER_SECOND)
  const transcriptionPromptTokens = segmentCount * PROMPT_TOKENS_PER_SEGMENT
  const transcriptionEstimatedUsd = usdFromTokens(
    transcriptionAudioTokens + transcriptionPromptTokens,
    segmentCount * 400,
    COST_RATES.audioIn,
    COST_RATES.audioOut,
  )

  const transcriptChars = Math.round(durationMinutes * CHARS_PER_MEETING_MINUTE)
  const analysisDirectTokens = Math.ceil(transcriptChars / 4) + ANALYSIS_OUTPUT_TOKENS
  const analysisDirectEstimatedUsd = usdFromTokens(
    Math.ceil(transcriptChars / 4),
    ANALYSIS_OUTPUT_TOKENS,
    COST_RATES.flashIn,
    COST_RATES.flashOut,
  )

  const chunkCount = Math.max(1, Math.ceil(transcriptChars / chunkChars))
  const useHierarchical = transcriptChars > directMax
  const hierarchicalPasses = useHierarchical ? chunkCount + 1 : 1
  const tokensPerPass = Math.ceil(Math.min(transcriptChars, chunkChars) / 4) + 800
  const analysisHierarchicalTokens = hierarchicalPasses * tokensPerPass
  const analysisHierarchicalEstimatedUsd = usdFromTokens(
    hierarchicalPasses * Math.ceil(Math.min(transcriptChars, chunkChars) / 4),
    hierarchicalPasses * 800,
    COST_RATES.flashIn,
    COST_RATES.flashOut,
  )

  return {
    durationMinutes,
    segmentSeconds,
    segmentCount,
    transcriptionAudioTokens,
    transcriptionPromptTokens,
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
