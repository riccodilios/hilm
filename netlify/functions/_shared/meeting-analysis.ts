/**
 * Meeting analysis cost controls: transcript hashing, direct vs hierarchical paths.
 * Multilingual transcript text is passed through unchanged — no LLM "cleanup" of STT.
 *
 * Long transcripts are analysed in resumable steps, one model call each, so a step always fits
 * the 60 s function budget: every transcript window is extracted into a partial analysis, partials
 * are merged in groups that fit the model input (more levels for very long meetings), and a final
 * merge produces the meeting analysis. Nothing is truncated or silently dropped; finished steps are
 * stored in AnalysisProgress so a retry resumes where it stopped.
 */
import {
  analysisResponseSchema,
  buildAnalysisPrompt,
  buildAnalysisTranscript,
  extractJsonObject,
  sanitizeAnalysis,
  type AnalysisLine,
  type AnalysisResponse,
} from './meeting-core'
import { getAiRuntimeConfig } from './ai-config'
import { hashStable, runAiCompletion } from './ai-gateway'
import { addUsage, estimateTokensFromText, type AiUsageTokens } from './ai-guard'

export function hashAnalysisInput(lines: AnalysisLine[]): string {
  // Stable fingerprint of what the model would see (text + speakers + timing).
  const payload = lines
    .map((line) => `${line.ref}|${line.speakerLabel}|${line.startMs}|${line.text}`)
    .join('\n')
  return hashStable(payload)
}

/** Split transcript lines into character-bounded windows without cutting a line. */
export function splitTranscriptWindows(lines: AnalysisLine[], maxChars: number): AnalysisLine[][] {
  if (!lines.length) return []
  const windows: AnalysisLine[][] = []
  let current: AnalysisLine[] = []
  let size = 0
  for (const line of lines) {
    const row = `[#${line.ref}] ${line.speakerLabel}: ${line.text}`
    const next = size + row.length + 1
    if (current.length && next > maxChars) {
      windows.push(current)
      current = []
      size = 0
    }
    current.push(line)
    size += row.length + 1
  }
  if (current.length) windows.push(current)
  return windows
}

function emptyTokens(): AiUsageTokens {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
}

/** Provider usage for one call, or a text-length estimate when the provider omitted it. */
function callUsage(tokens: AiUsageTokens | undefined, sentText: string, reply: string): AiUsageTokens {
  if (tokens?.totalTokens) return tokens
  const inputTokens = estimateTokensFromText(sentText)
  const outputTokens = estimateTokensFromText(reply)
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd: null }
}

/** Merge inputs stay below this many characters of partial-analysis JSON. */
export const ANALYSIS_MERGE_MAX_CHARS = 90_000

export type AnalysisProgress = {
  v: 1
  hash: string
  /** levels[0]: one partial per transcript window; levels[k]: merged groups of levels[k-1]. */
  levels: Array<Array<AnalysisResponse | null>>
}

export type AnalysisStep =
  | { kind: 'direct'; key: 'direct' }
  | { kind: 'chunk'; key: string; index: number; total: number }
  | { kind: 'merge'; key: string; level: number; group: number; members: number[] }
  | { kind: 'final'; key: string; level: number }

export type AnalysisInput = {
  apiKey: string
  title: string
  meetingDate: string | null
  projectName: string | null
  roster: Array<{ label: string; display_name: string | null }>
  locale: 'en' | 'ar'
  timeZone?: string | null
  lines: AnalysisLine[]
  model: string
}

type Sizes = { directMaxChars: number; chunkChars: number; mergeMaxChars: number }

function analysisSizes(): Sizes {
  const config = getAiRuntimeConfig()
  return {
    directMaxChars: config.meeting.directAnalysisMaxChars,
    chunkChars: config.meeting.hierarchicalChunkChars,
    mergeMaxChars: ANALYSIS_MERGE_MAX_CHARS,
  }
}

/** Consecutive groups of partials whose JSON fits one merge call (at least two per group). */
export function groupPartialsForMerge(items: AnalysisResponse[], maxChars: number): number[][] {
  const groups: number[][] = []
  let current: number[] = []
  let size = 2
  items.forEach((item, i) => {
    const itemSize = JSON.stringify(item).length + 1
    if (current.length >= 2 && size + itemSize > maxChars) {
      groups.push(current)
      current = []
      size = 2
    }
    current.push(i)
    size += itemSize
  })
  if (current.length) {
    // Never leave a lone trailing partial: it would not shrink the next level.
    if (current.length === 1 && groups.length) groups[groups.length - 1]!.push(current[0]!)
    else groups.push(current)
  }
  return groups
}

/**
 * Decide the next analysis step for these transcript lines. A stored progress is reused only
 * when it belongs to exactly the same transcript (hash and window count).
 */
export function planAnalysis(
  lines: AnalysisLine[],
  stored: AnalysisProgress | null | undefined,
  sizes: Sizes = analysisSizes(),
): { step: AnalysisStep; progress: AnalysisProgress | null; windows: AnalysisLine[][] } {
  const fullLength = buildAnalysisTranscript(lines, Number.POSITIVE_INFINITY).length
  if (fullLength <= sizes.directMaxChars) return { step: { kind: 'direct', key: 'direct' }, progress: null, windows: [lines] }

  const windows = splitTranscriptWindows(lines, sizes.chunkChars)
  const hash = hashAnalysisInput(lines)
  const valid =
    stored?.v === 1 && stored.hash === hash && Array.isArray(stored.levels) && stored.levels[0]?.length === windows.length
  const progress: AnalysisProgress = valid
    ? { v: 1, hash, levels: stored!.levels.map((level) => [...level]) }
    : { v: 1, hash, levels: [windows.map(() => null)] }

  const missingChunk = progress.levels[0]!.findIndex((partial) => partial === null)
  if (missingChunk >= 0) {
    return { step: { kind: 'chunk', key: `c${missingChunk}`, index: missingChunk, total: windows.length }, progress, windows }
  }

  for (let level = 0; ; level += 1) {
    const items = progress.levels[level] as AnalysisResponse[]
    if (items.length === 1 || JSON.stringify(items).length <= sizes.mergeMaxChars) {
      progress.levels.length = level + 1
      return { step: { kind: 'final', key: `f${level}`, level }, progress, windows }
    }
    const groups = groupPartialsForMerge(items, sizes.mergeMaxChars)
    if (progress.levels[level + 1]?.length !== groups.length) {
      progress.levels[level + 1] = groups.map(() => null)
      progress.levels.length = level + 2
    }
    const next = progress.levels[level + 1]!
    const missing = next.findIndex((partial) => partial === null)
    if (missing >= 0) {
      return {
        step: { kind: 'merge', key: `m${level}g${missing}`, level, group: missing, members: groups[missing]! },
        progress,
        windows,
      }
    }
  }
}

/** The model a step bills against (chunk extraction can use a cheaper model). */
export function analysisStepModel(step: AnalysisStep, input: Pick<AnalysisInput, 'model'>) {
  return step.kind === 'chunk' ? getAiRuntimeConfig().models.meeting_chunk_summary : input.model
}

/** A final step over a single partial needs no model call. */
export function analysisStepCallsModel(step: AnalysisStep, progress: AnalysisProgress | null) {
  if (step.kind !== 'final') return true
  return (progress?.levels[step.level]?.length ?? 0) > 1
}

export type AnalysisStepResult =
  | {
      ok: true
      done: true
      analysis: ReturnType<typeof sanitizeAnalysis>
      model: string
      usage: AiUsageTokens
      strategy: 'direct' | 'hierarchical'
      analysisInputHash: string
    }
  | { ok: true; done: false; progress: AnalysisProgress; model: string; usage: AiUsageTokens }
  | { ok: false; code: string; detail: string; usage: AiUsageTokens; model: string }

type CallResult = { ok: true; data: AnalysisResponse; usage: AiUsageTokens; model: string } | Extract<AnalysisStepResult, { ok: false }>

/** One JSON completion; an unreadable reply is asked once more before the step fails. */
async function callForAnalysis(input: {
  apiKey: string
  feature: 'meeting_analyze' | 'meeting_chunk_summary'
  model: string
  maxTokens: number
  temperature: number
  title: string
  system: string
  user: string
}): Promise<CallResult> {
  let usage = emptyTokens()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await runAiCompletion({
      apiKey: input.apiKey,
      feature: input.feature,
      model: input.model,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      responseFormat: { type: 'json_object' },
      title: input.title,
      // Single gateway attempt under the Netlify function budget — retries waste credits on timeouts.
      allowRetry: false,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    })
    if (!result.ok) {
      return { ok: false, code: result.code, detail: result.detail, usage: addUsage(usage, result.tokens ?? emptyTokens()), model: result.model }
    }
    usage = addUsage(usage, callUsage(result.tokens, input.system + input.user, result.content))
    const parsedJson = extractJsonObject(result.content)
    const parsed = parsedJson ? analysisResponseSchema.safeParse(parsedJson) : null
    if (parsed?.success) return { ok: true, data: parsed.data, usage, model: result.model }
  }
  return { ok: false, code: 'parse_error', detail: 'Unreadable analysis', usage, model: input.model }
}

/** Runs exactly one analysis step (at most one model call, plus one re-ask on unreadable JSON). */
export async function executeAnalysisStep(
  input: AnalysisInput,
  planned: { step: AnalysisStep; progress: AnalysisProgress | null; windows: AnalysisLine[][] },
): Promise<AnalysisStepResult> {
  const config = getAiRuntimeConfig()
  const analysisInputHash = hashAnalysisInput(input.lines)
  const displayNames: Record<string, string> = {}
  for (const speaker of input.roster) {
    if (speaker.display_name) displayNames[speaker.label] = speaker.display_name
  }
  const sanitizeOpts = { lines: input.lines, rosterLabels: input.roster.map((speaker) => speaker.label), displayNames }
  const systemPrompt = buildAnalysisPrompt({
    title: input.title,
    meetingDate: input.meetingDate,
    projectName: input.projectName,
    roster: input.roster,
    locale: input.locale,
    timeZone: input.timeZone,
  })
  const { step } = planned

  if (step.kind === 'direct') {
    const transcript = buildAnalysisTranscript(input.lines, Number.POSITIVE_INFINITY)
    const result = await callForAnalysis({
      apiKey: input.apiKey,
      feature: 'meeting_analyze',
      model: input.model,
      maxTokens: config.maxTokens.meeting_analyze,
      temperature: 0.2,
      title: 'Hilm Meeting Analysis',
      system: systemPrompt,
      user: `Transcript:\n${transcript}`,
    })
    if (!result.ok) return result
    return {
      ok: true,
      done: true,
      analysis: sanitizeAnalysis(result.data, sanitizeOpts),
      model: result.model,
      usage: result.usage,
      strategy: 'direct',
      analysisInputHash,
    }
  }

  const progress = planned.progress!
  if (step.kind === 'chunk') {
    const windowLines = planned.windows[step.index]!
    const result = await callForAnalysis({
      apiKey: input.apiKey,
      feature: 'meeting_chunk_summary',
      model: config.models.meeting_chunk_summary,
      maxTokens: config.maxTokens.meeting_chunk_summary,
      temperature: 0.1,
      title: 'Hilm Meeting Chunk Analysis',
      system: `${systemPrompt}

The transcript below is part ${step.index + 1} of ${step.total} of one long meeting, in order. Extract structured JSON for THAT PART only, same schema.`,
      user: `Transcript part ${step.index + 1}/${step.total}:\n${buildAnalysisTranscript(windowLines, Number.POSITIVE_INFINITY)}`,
    })
    if (!result.ok) return result
    progress.levels[0]![step.index] = result.data
    return { ok: true, done: false, progress, model: result.model, usage: result.usage }
  }

  const sources =
    step.kind === 'merge'
      ? step.members.map((i) => progress.levels[step.level]![i]!)
      : (progress.levels[step.level] as AnalysisResponse[])

  if (step.kind === 'final' && sources.length === 1) {
    return {
      ok: true,
      done: true,
      analysis: sanitizeAnalysis(sources[0]!, sanitizeOpts),
      model: input.model,
      usage: emptyTokens(),
      strategy: 'hierarchical',
      analysisInputHash,
    }
  }

  const scope =
    step.kind === 'merge'
      ? `You are merging ${sources.length} partial analyses that cover consecutive parts of one long multilingual meeting, in order, into ONE partial analysis for that span.`
      : `You are merging ${sources.length} partial analyses that together cover one entire multilingual meeting, in order, into the single final JSON.`
  const result = await callForAnalysis({
    apiKey: input.apiKey,
    feature: 'meeting_analyze',
    model: input.model,
    maxTokens: config.maxTokens.meeting_analyze,
    temperature: 0.2,
    title: step.kind === 'merge' ? 'Hilm Meeting Analysis Merge (partial)' : 'Hilm Meeting Analysis Merge',
    system: `${systemPrompt}

${scope}
Cover the beginning, middle and end equally. Keep every distinct decision and action item; deduplicate only items that are clearly the same. Prefer confirmed over possible when merging.
Preserve English technical terms and proper nouns. Do not invent items not supported by the partials.
Return the same JSON schema.`,
    user: `Partials (in meeting order):\n${JSON.stringify(sources)}`,
  })
  if (!result.ok) return result
  if (step.kind === 'merge') {
    progress.levels[step.level + 1]![step.group] = result.data
    return { ok: true, done: false, progress, model: result.model, usage: result.usage }
  }
  return {
    ok: true,
    done: true,
    analysis: sanitizeAnalysis(result.data, sanitizeOpts),
    model: result.model,
    usage: result.usage,
    strategy: 'hierarchical',
    analysisInputHash,
  }
}

export type MeetingAnalysisRun =
  | {
      ok: true
      analysis: ReturnType<typeof sanitizeAnalysis>
      model: string
      usage: AiUsageTokens
      strategy: 'direct' | 'hierarchical'
      analysisInputHash: string
    }
  | { ok: false; code: string; detail: string; usage: AiUsageTokens; model: string }

/** Runs every step in one process (scripts and benchmarks; production runs one step per request). */
export async function runMeetingAnalysis(input: AnalysisInput): Promise<MeetingAnalysisRun> {
  let progress: AnalysisProgress | null = null
  let usage = emptyTokens()
  for (let guard = 0; guard < 500; guard += 1) {
    const planned = planAnalysis(input.lines, progress)
    const result = await executeAnalysisStep(input, planned)
    usage = addUsage(usage, result.usage)
    if (!result.ok) return { ...result, usage }
    if (result.done) {
      return {
        ok: true,
        analysis: result.analysis,
        model: result.model,
        usage,
        strategy: result.strategy,
        analysisInputHash: result.analysisInputHash,
      }
    }
    progress = result.progress
  }
  return { ok: false, code: 'parse_error', detail: 'Analysis did not converge', usage, model: input.model }
}
