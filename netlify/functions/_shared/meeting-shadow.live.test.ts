/**
 * Real-meeting shadow benchmark. Skipped unless MEETING_SHADOW=1. Never runs in CI.
 *
 * Replays privately downloaded meeting parts (MEETING_SHADOW_DIR, default %LOCALAPPDATA%/hilm-shadow,
 * outside the repo) through the production prompt builder, silence trim, transcriber, retry/split
 * policy, stitcher and analysis runner with one STT model. Nothing is written to the database.
 * Transcripts and analysis stay in the private directory; only aggregate cost/reliability numbers
 * go to benchmarks/meeting-ai/real-<label>.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAiRuntimeConfig } from './ai-config'
import { tokensFromOpenRouterUsage } from './ai-guard'
import {
  buildTranscriptionPrompt,
  stitchChunkSegments,
  type AnalysisLine,
  type RosterSpeaker,
  type StitchedSegment,
  MEETING_DEFAULT_VOCABULARY,
  MEETING_TRANSCRIBE_MODEL,
} from './meeting-core'
import { runMeetingAnalysis } from './meeting-analysis'
import { transcribeAudioChunk } from './meeting-transcriber'

const enabled = process.env.MEETING_SHADOW === '1'
if (enabled && existsSync('.env')) process.loadEnvFile('.env')
const DIR = process.env.MEETING_SHADOW_DIR || join(process.env.LOCALAPPDATA ?? '.', 'hilm-shadow')
const LABEL = (process.env.MEETING_SHADOW_LABEL || 'run').replace(/[^a-z0-9_-]/gi, '')
const STT_MODEL = process.env.MEETING_SHADOW_STT_MODEL?.trim() || MEETING_TRANSCRIBE_MODEL
/** Reference runs may use a slower model; production keeps its own deadline. */
const DEADLINE_MS = Number(process.env.MEETING_SHADOW_DEADLINE_MS) || undefined
const ANALYSIS = process.env.MEETING_SHADOW_ANALYSIS !== '0'
const ONLY = (process.env.MEETING_SHADOW_MEETINGS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
/** MEETING_SHADOW_STT_REASONING=low|medium|high adds a reasoning budget to STT calls only. */
const STT_REASONING = process.env.MEETING_SHADOW_STT_REASONING?.trim() || null

if (enabled && STT_REASONING) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (typeof init?.body === 'string' && new Headers(init.headers).get('X-Title') === 'Hilm Meeting Transcription') {
      const body = JSON.parse(init.body) as Record<string, unknown>
      return originalFetch(input, { ...init, body: JSON.stringify({ ...body, reasoning: { effort: STT_REASONING } }) })
    }
    return originalFetch(input, init)
  }
}

type Manifest = Array<{
  id: string
  title: string
  locale: 'en' | 'ar'
  durationSeconds: number
  projectName: string | null
  segments: Array<{ idx: number; offsetMs: number; durationMs: number; file: string }>
}>

function usageOf(raw: unknown) {
  const u = tokensFromOpenRouterUsage(raw)
  const r = raw as { completion_tokens_details?: { reasoning_tokens?: number } } | undefined
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    audioTokens: u.audioTokens ?? 0,
    reasoningTokens: r?.completion_tokens_details?.reasoning_tokens ?? 0,
    costUsd: u.costUsd ?? 0,
  }
}

describe.skipIf(!enabled)('real-meeting shadow benchmark', () => {
  const manifest = enabled ? (JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as Manifest) : []
  const apiKey = process.env.OPENROUTER_API_KEY ?? ''
  const outDir = join(DIR, 'out', LABEL)
  const summary: Record<string, unknown>[] = []

  for (const meeting of manifest.filter((m) => !ONLY.length || ONLY.includes(m.id))) {
    it(`meeting ${meeting.id.slice(0, 8)} (${meeting.durationSeconds}s)`, async () => {
      expect(apiKey).toBeTruthy()
      const stitched: StitchedSegment[] = []
      const roster: RosterSpeaker[] = []
      const parts: Record<string, unknown>[] = []
      const previousLimit = getAiRuntimeConfig().meeting.previousContextLines
      for (const segment of meeting.segments) {
        const path = join(DIR, segment.file)
        if (!existsSync(path)) throw new Error(`missing audio part ${segment.idx}`)
        const audioBase64 = readFileSync(path).toString('base64')
        const previousLines = stitched.slice(-previousLimit).map((row) => ({ label: row.speakerLabel, text: row.text }))
        const prompt = buildTranscriptionPrompt({
          roster,
          previousLines,
          chunkIdx: segment.idx,
          vocabulary: [...(meeting.projectName ? [meeting.projectName] : []), ...MEETING_DEFAULT_VOCABULARY],
        })
        const started = Date.now()
        const usages: ReturnType<typeof usageOf>[] = []
        const codes: Array<string | null> = []
        let result = await transcribeAudioChunk({ apiKey, audioBase64, prompt, model: STT_MODEL, deadlineMs: DEADLINE_MS })
        usages.push(usageOf(result.usage))
        codes.push(result.ok ? null : result.code)
        // Mirrors the engine: up to 3 attempts, attempt >= 2 uses the split path.
        while (!result.ok && codes.length < 3) {
          result = await transcribeAudioChunk({ apiKey, audioBase64, prompt, model: STT_MODEL, deadlineMs: DEADLINE_MS, split: true })
          usages.push(usageOf(result.usage))
          codes.push(result.ok ? null : result.code)
        }
        const latencyMs = Date.now() - started
        const total = usages.reduce(
          (acc, u) => ({
            inputTokens: acc.inputTokens + u.inputTokens,
            outputTokens: acc.outputTokens + u.outputTokens,
            audioTokens: acc.audioTokens + u.audioTokens,
            reasoningTokens: acc.reasoningTokens + u.reasoningTokens,
            costUsd: acc.costUsd + u.costUsd,
          }),
          { inputTokens: 0, outputTokens: 0, audioTokens: 0, reasoningTokens: 0, costUsd: 0 },
        )
        const part: Record<string, unknown> = {
          idx: segment.idx,
          durationMs: segment.durationMs,
          sentMs: result.audio.sentMs,
          latencyMs,
          attempts: codes.length,
          codes,
          ok: result.ok,
          lines: 0,
          ...total,
        }
        parts.push(part)
        if (!result.ok) continue
        const rows = stitchChunkSegments({
          response: result.data,
          chunkIdx: segment.idx,
          offsetMs: segment.offsetMs,
          durationMs: segment.durationMs,
          roster,
        })
        part.lines = rows.length
        stitched.push(...rows)
        const descriptions = new Map((result.data.speakers ?? []).map((s) => [s.label.trim(), s.description ?? null]))
        for (const label of new Set(rows.map((row) => row.speakerLabel))) {
          if (!roster.some((speaker) => speaker.label === label)) {
            roster.push({ id: `spk-${label}`, label, description: descriptions.get(label) ?? null })
          }
        }
      }

      let analysis: Record<string, unknown> | null = null
      if (ANALYSIS && stitched.length) {
        const lines: AnalysisLine[] = stitched.map((row, i) => ({
          ref: i + 1,
          segmentId: `seg-${i + 1}`,
          speakerLabel: row.speakerLabel,
          startMs: row.start_ms,
          text: row.text,
        }))
        const model = getAiRuntimeConfig().models.meeting_analyze
        const started = Date.now()
        const result = await runMeetingAnalysis({
          apiKey,
          title: meeting.title,
          meetingDate: null,
          projectName: meeting.projectName,
          roster: roster.map((speaker) => ({ label: speaker.label, display_name: null })),
          locale: meeting.locale,
          timeZone: 'Asia/Riyadh',
          lines,
          model,
        })
        analysis = result.ok
          ? {
              ok: true,
              model,
              latencyMs: Date.now() - started,
              strategy: result.strategy,
              usage: result.usage,
              summary: result.analysis.summary,
              keyPoints: result.analysis.key_points,
              decisions: result.analysis.decisions.map((d) => ({ certainty: d.certainty, text: d.text })),
              actions: result.analysis.action_items.map((a) => ({
                certainty: a.certainty,
                title: a.title,
                description: a.description ?? null,
                owner: a.ownerLabel ?? null,
                due: a.due_text ?? null,
              })),
            }
          : { ok: false, model, code: result.code }
      }

      mkdirSync(outDir, { recursive: true })
      writeFileSync(
        join(outDir, `${meeting.id}.json`),
        JSON.stringify({ model: STT_MODEL, meetingId: meeting.id, parts, roster, transcript: stitched, analysis }, null, 1),
      )
      const audioSeconds = meeting.segments.reduce((n, s) => n + s.durationMs, 0) / 1000
      const sttCost = parts.reduce((n, p) => n + Number(p.costUsd), 0)
      summary.push({
        meeting: meeting.id.slice(0, 8),
        audioSeconds,
        parts: parts.length,
        failedParts: parts.filter((p) => !p.ok).length,
        attempts: parts.reduce((n, p) => n + Number(p.attempts), 0),
        maxLatencyMs: Math.max(...parts.map((p) => Number(p.latencyMs))),
        sttCostUsd: Number(sttCost.toFixed(6)),
        sttPerHourUsd: Number(((sttCost / audioSeconds) * 3600).toFixed(4)),
        outputTokens: parts.reduce((n, p) => n + Number(p.outputTokens), 0),
        reasoningTokens: parts.reduce((n, p) => n + Number(p.reasoningTokens), 0),
        lines: stitched.length,
        speakers: roster.length,
        analysisOk: analysis ? analysis.ok : null,
        analysisCostUsd: analysis && analysis.ok ? Number((analysis.usage as { costUsd?: number | null }).costUsd ?? 0) : null,
      })
      writeFileSync(
        join('benchmarks', 'meeting-ai', `real-${LABEL}.json`),
        JSON.stringify({ label: LABEL, model: STT_MODEL, createdAt: new Date().toISOString(), meetings: summary }, null, 1),
      )
    }, 60 * 60_000)
  }
})
