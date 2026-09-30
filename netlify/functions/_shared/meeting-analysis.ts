/**
 * Meeting analysis cost controls: transcript hashing, direct vs hierarchical paths.
 * Multilingual transcript text is passed through unchanged — no LLM "cleanup" of STT.
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
import { estimateTokensFromText, type AiUsageTokens } from './ai-guard'

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
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

function addTokens(a: AiUsageTokens, b: AiUsageTokens): AiUsageTokens {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

export type MeetingAnalysisRun = {
  ok: true
  analysis: ReturnType<typeof sanitizeAnalysis>
  model: string
  usage: AiUsageTokens
  strategy: 'direct' | 'hierarchical' | 'cached'
  analysisInputHash: string
} | {
  ok: false
  code: string
  detail: string
  usage: AiUsageTokens
  model: string
}

export async function runMeetingAnalysis(input: {
  apiKey: string
  title: string
  meetingDate: string | null
  projectName: string | null
  roster: Array<{ label: string; display_name: string | null }>
  locale: 'en' | 'ar'
  timeZone?: string | null
  lines: AnalysisLine[]
  model: string
  /** Skip AI when hash matches a prior successful analysis. */
  existing?: { summary: string | null; analysisInputHash: string | null } | null
}): Promise<MeetingAnalysisRun> {
  const config = getAiRuntimeConfig()
  const analysisInputHash = hashAnalysisInput(input.lines)

  if (
    input.existing?.analysisInputHash &&
    input.existing.analysisInputHash === analysisInputHash &&
    input.existing.summary
  ) {
    return {
      ok: true,
      analysis: {
        language: null,
        summary: input.existing.summary,
        key_points: [],
        decisions: [],
        action_items: [],
      },
      model: input.model,
      usage: emptyTokens(),
      strategy: 'cached',
      analysisInputHash,
    }
  }

  const displayNames: Record<string, string> = {}
  for (const speaker of input.roster) {
    if (speaker.display_name) displayNames[speaker.label] = speaker.display_name
  }
  const sanitizeOpts = {
    lines: input.lines,
    rosterLabels: input.roster.map((speaker) => speaker.label),
    displayNames,
  }

  const systemPrompt = buildAnalysisPrompt({
    title: input.title,
    meetingDate: input.meetingDate,
    projectName: input.projectName,
    roster: input.roster,
    locale: input.locale,
    timeZone: input.timeZone,
  })
  const fullTranscript = buildAnalysisTranscript(input.lines)

  if (fullTranscript.length <= config.meeting.directAnalysisMaxChars) {
    const result = await runAiCompletion({
      apiKey: input.apiKey,
      feature: 'meeting_analyze',
      model: input.model,
      maxTokens: config.maxTokens.meeting_analyze,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      title: 'Hilm Meeting Analysis',
      // Single attempt under the Netlify function budget — retries waste credits on timeouts.
      allowRetry: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcript:\n${fullTranscript}` },
      ],
    })
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        detail: result.detail,
        usage: result.tokens ?? emptyTokens(),
        model: result.model,
      }
    }
    let usage = result.tokens
    if (!usage.totalTokens) {
      const inputTokens = estimateTokensFromText(systemPrompt + fullTranscript)
      const outputTokens = estimateTokensFromText(result.content)
      usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
    }
    const parsedJson = extractJsonObject(result.content)
    const parsed = parsedJson ? analysisResponseSchema.safeParse(parsedJson) : null
    if (!parsed?.success) {
      return { ok: false, code: 'parse_error', detail: 'Unreadable analysis', usage, model: result.model }
    }
    return {
      ok: true,
      analysis: sanitizeAnalysis(parsed.data, sanitizeOpts),
      model: result.model,
      usage,
      strategy: 'direct',
      analysisInputHash,
    }
  }

  // Hierarchical: chunk extract → merge (avoids re-sending the full 2h transcript many times).
  const windows = splitTranscriptWindows(input.lines, config.meeting.hierarchicalChunkChars)
  let usage = emptyTokens()
  const partials: AnalysisResponse[] = []

  for (let i = 0; i < windows.length; i++) {
    const windowLines = windows[i]!
    const chunkText = buildAnalysisTranscript(windowLines)
    const chunkPrompt = `${systemPrompt}

This is part ${i + 1} of ${windows.length} of a long meeting. Extract structured JSON for THIS PART only.
Keep English technical terms and proper nouns in Latin script. Do not translate the transcript.
Return the same JSON schema (language, summary, key_points, decisions, action_items).`
    const result = await runAiCompletion({
      apiKey: input.apiKey,
      feature: 'meeting_chunk_summary',
      model: config.models.meeting_chunk_summary,
      maxTokens: config.maxTokens.meeting_chunk_summary,
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
      title: 'Hilm Meeting Chunk Analysis',
      allowRetry: false,
      messages: [
        { role: 'system', content: chunkPrompt },
        { role: 'user', content: `Transcript part ${i + 1}/${windows.length}:\n${chunkText}` },
      ],
    })
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        detail: result.detail,
        usage: addTokens(usage, result.tokens ?? emptyTokens()),
        model: result.model,
      }
    }
    usage = addTokens(usage, result.tokens.totalTokens ? result.tokens : {
      inputTokens: estimateTokensFromText(chunkPrompt + chunkText),
      outputTokens: estimateTokensFromText(result.content),
      totalTokens: 0,
    })
    if (!usage.totalTokens) {
      usage.totalTokens = usage.inputTokens + usage.outputTokens
    }
    const parsedJson = extractJsonObject(result.content)
    const parsed = parsedJson ? analysisResponseSchema.safeParse(parsedJson) : null
    if (parsed?.success) partials.push(parsed.data)
  }

  if (!partials.length) {
    return { ok: false, code: 'parse_error', detail: 'No chunk analyses produced', usage, model: input.model }
  }

  const mergePrompt = `${systemPrompt}

You are merging ${partials.length} partial analyses of one long multilingual meeting into a single final JSON.
Deduplicate decisions and action items. Prefer confirmed over possible when merging.
Preserve English technical terms and proper nouns. Do not invent items not supported by the partials.
Return the same JSON schema.`

  const mergeResult = await runAiCompletion({
    apiKey: input.apiKey,
    feature: 'meeting_analyze',
    model: input.model,
    maxTokens: config.maxTokens.meeting_analyze,
    temperature: 0.2,
    responseFormat: { type: 'json_object' },
    title: 'Hilm Meeting Analysis Merge',
    allowRetry: false,
    messages: [
      { role: 'system', content: mergePrompt },
      { role: 'user', content: `Partials:\n${JSON.stringify(partials).slice(0, 120_000)}` },
    ],
  })
  if (!mergeResult.ok) {
    return {
      ok: false,
      code: mergeResult.code,
      detail: mergeResult.detail,
      usage: addTokens(usage, mergeResult.tokens ?? emptyTokens()),
      model: mergeResult.model,
    }
  }
  usage = addTokens(usage, mergeResult.tokens.totalTokens ? mergeResult.tokens : {
    inputTokens: estimateTokensFromText(mergePrompt + JSON.stringify(partials)),
    outputTokens: estimateTokensFromText(mergeResult.content),
    totalTokens: 0,
  })
  if (!usage.totalTokens) usage.totalTokens = usage.inputTokens + usage.outputTokens

  const mergedJson = extractJsonObject(mergeResult.content)
  const merged = mergedJson ? analysisResponseSchema.safeParse(mergedJson) : null
  if (!merged?.success) {
    return {
      ok: false,
      code: 'parse_error',
      detail: 'Unreadable merged analysis',
      usage,
      model: mergeResult.model,
    }
  }

  return {
    ok: true,
    analysis: sanitizeAnalysis(merged.data, sanitizeOpts),
    model: mergeResult.model,
    usage,
    strategy: 'hierarchical',
    analysisInputHash,
  }
}
