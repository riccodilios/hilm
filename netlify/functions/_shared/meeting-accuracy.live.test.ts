/**
 * Live accuracy test against OpenRouter. Skipped unless MEETING_ACCURACY=1 (see `npm run test:meeting-accuracy`).
 * Audio is synthesized locally with Windows System.Speech (two distinct voices), then run through the
 * production segmenter, prompt, transcriber, stitcher and analysis sanitizer.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PcmSegmenter } from '../../../src/shared/meetings/recorder/segmenter'
import { MEETING_SAMPLE_RATE, samplesToMs } from '../../../src/shared/meetings/recorder/wav-encoder'
import {
  analysisResponseSchema,
  buildAnalysisPrompt,
  buildAnalysisTranscript,
  buildTranscriptionPrompt,
  extractJsonObject,
  sanitizeAnalysis,
  stitchChunkSegments,
  type AnalysisLine,
  type RosterSpeaker,
  type StitchedSegment,
} from './meeting-core'
import { callOpenRouter, transcribeAudioChunk, type TranscribeChunkResult } from './meeting-transcriber'

const enabled = process.env.MEETING_ACCURACY === '1' && process.platform === 'win32'

type Voice = 'lead' | 'engineer'
const VOICES: Record<Voice, string> = { lead: 'Microsoft Zira Desktop', engineer: 'Microsoft David Desktop' }

const SCRIPT: Array<[Voice, string]> = [
  ['lead', 'Good morning everyone. Thanks for joining the weekly planning meeting for the mobile app redesign.'],
  ['engineer', 'Morning. I reviewed the design files yesterday and I have a few concerns about the onboarding flow.'],
  ['lead', "Okay, let's start there. What is the main problem you noticed?"],
  ['engineer', 'The signup screen asks for too much information up front. Most people will abandon it before they finish.'],
  ['lead', 'That makes sense. Could we move the profile questions to a later step, after the first login?'],
  ['engineer', 'Yes, I think that would work. We would only ask for an email address and a password at the beginning.'],
  ['lead', "Great. Then let's decide that the signup screen will only collect email and password."],
  ['engineer', 'Agreed. I will update the wireframes and share them with the team before Thursday.'],
  ['lead', 'Perfect. The next topic is the notification settings. Customers keep asking for a quiet mode during the weekend.'],
  ['engineer', 'We could add a simple toggle in the settings page. It should be easy to build.'],
  ['lead', 'I like that idea, but we need to check with the backend team about scheduling.'],
  ['engineer', 'I can talk to Omar about it this afternoon, and I will report back tomorrow.'],
  ['lead', 'Thank you. Another item is the performance of the dashboard. It still takes several seconds to load on older phones.'],
  ['engineer', 'I measured it last week. Most of the delay comes from loading every chart at the same time.'],
  ['lead', 'So should we load the charts only when the user scrolls to them?'],
  ['engineer', 'Exactly. Lazy loading should cut the waiting time roughly in half.'],
  ['lead', "Alright. Let's make lazy loading the priority for the next sprint."],
  ['engineer', 'Sounds good. Should we also invite the support team to the next review?'],
  ['lead', 'Yes, please send them an invitation. Their feedback about customer complaints would be really helpful.'],
  ['engineer', 'Will do. Is there anything else we need to cover today?'],
  ['lead', 'I think that is everything. Thanks everyone, and see you next week.'],
]

const GAP_MS = 600
const WER_LIMIT = 0.12
const SPEAKER_ACCURACY_LIMIT = 0.85

// ── Helpers ────────────────────────────────────────────────────────────────

function loadApiKey() {
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim()
  if (fromEnv) return fromEnv
  if (!existsSync('.env')) return ''
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((row) => row.startsWith('OPENROUTER_API_KEY='))
  return line?.slice('OPENROUTER_API_KEY='.length).trim().replace(/^["']|["']$/g, '') ?? ''
}

function synthesize(dir: string, jobs: Array<{ voice: string; text: string; path: string }>) {
  const jobsPath = join(dir, 'jobs.json')
  const scriptPath = join(dir, 'synth.ps1')
  writeFileSync(jobsPath, JSON.stringify(jobs), 'utf8')
  writeFileSync(
    scriptPath,
    [
      'param([string]$JobsPath)',
      'Add-Type -AssemblyName System.Speech',
      '$jobs = Get-Content -Raw -Encoding UTF8 $JobsPath | ConvertFrom-Json',
      '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      'foreach ($job in $jobs) {',
      '  $synth.SelectVoice($job.voice)',
      '  $synth.SetOutputToWaveFile($job.path, $fmt)',
      '  $synth.Speak($job.text)',
      '  $synth.SetOutputToNull()',
      '}',
      '$synth.Dispose()',
    ].join('\r\n'),
    'utf8',
  )
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, jobsPath], {
    stdio: 'pipe',
  })
}

function readWavPcm(path: string): Int16Array {
  const buf = readFileSync(path)
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      const bytes = buf.subarray(offset + 8, offset + 8 + size)
      return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error(`No data chunk in ${path}`)
}

/** Low-level deterministic room noise (~-46 dBFS) so the audio is not digitally perfect. */
function addNoise(pcm: Int16Array, amplitude = 160) {
  let seed = 1234567
  for (let i = 0; i < pcm.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const noise = ((seed / 0x7fffffff) * 2 - 1) * amplitude
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i]! + noise)))
  }
  return pcm
}

function wavBase64(chunks: Int16Array[]) {
  const samples = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + samples * 2, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(MEETING_SAMPLE_RATE, 24)
  header.writeUInt32LE(MEETING_SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(samples * 2, 40)
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)))
  return Buffer.concat([header, body]).toString('base64')
}

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function wordErrors(reference: string[], hypothesis: string[]) {
  const rows = reference.length + 1
  const cols = hypothesis.length + 1
  const d = new Array<number>(rows * cols)
  for (let i = 0; i < rows; i += 1) d[i * cols] = i
  for (let j = 0; j < cols; j += 1) d[j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1
      d[i * cols + j] = Math.min(d[(i - 1) * cols + j]! + 1, d[i * cols + j - 1]! + 1, d[(i - 1) * cols + j - 1]! + cost)
    }
  }
  const errors = d[rows * cols - 1]!
  return { errors, wer: reference.length ? errors / reference.length : 0 }
}

async function transcribeWithRetry(input: Parameters<typeof transcribeAudioChunk>[0]) {
  let last: TranscribeChunkResult | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    last = await transcribeAudioChunk(input)
    if (last.ok) return { result: last, attempts: attempt + 1 }
  }
  return { result: last!, attempts: 2 }
}

// ── Test ───────────────────────────────────────────────────────────────────

describe.skipIf(!enabled)('meeting transcription accuracy (live OpenRouter)', () => {
  const apiKey = loadApiKey()
  let dir = ''
  let meetingPcm: Int16Array = new Int16Array(0)
  let silencePcm: Int16Array = new Int16Array(0)
  const stitched: StitchedSegment[] = []
  const roster: RosterSpeaker[] = []
  const report: Record<string, unknown> = {}

  beforeAll(() => {
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for the accuracy test')
    dir = mkdtempSync(join(tmpdir(), 'hilm-meeting-acc-'))
    const jobs = SCRIPT.map(([voice, text], i) => ({ voice: VOICES[voice], text, path: join(dir, `u${i}.wav`) }))
    synthesize(dir, jobs)
    const gap = new Int16Array(Math.round((GAP_MS / 1000) * MEETING_SAMPLE_RATE))
    const parts: Int16Array[] = []
    for (const job of jobs) parts.push(readWavPcm(job.path), gap)
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    meetingPcm = new Int16Array(total)
    let at = 0
    for (const part of parts) {
      meetingPcm.set(part, at)
      at += part.length
    }
    addNoise(meetingPcm)
    silencePcm = addNoise(new Int16Array(6 * MEETING_SAMPLE_RATE))
  }, 120_000)

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    console.log('\n[meeting-accuracy] report\n' + JSON.stringify(report, null, 2))
  })

  it(
    'transcribes a multi-part two-speaker meeting with low WER and consistent speakers',
    async () => {
      const segmenter = new PcmSegmenter()
      // Feed in ~250 ms blocks like the live recorder does.
      const block = MEETING_SAMPLE_RATE / 4
      const segments = []
      for (let i = 0; i < meetingPcm.length; i += block) segments.push(...segmenter.push(meetingPcm.subarray(i, i + block)))
      const tail = segmenter.flush()
      if (tail) segments.push(tail)
      expect(segments.length).toBeGreaterThanOrEqual(2)
      report.audioSeconds = Math.round(samplesToMs(meetingPcm.length) / 100) / 10
      report.parts = segments.map((s) => ({ idx: s.idx, offsetMs: s.offsetMs, durationMs: s.durationMs }))

      const perPart: Array<Record<string, unknown>> = []
      for (const segment of segments) {
        const previousLines = stitched.slice(-6).map((row) => ({ label: row.speakerLabel, text: row.text }))
        const prompt = buildTranscriptionPrompt({ roster, previousLines, languageHint: 'en', chunkIdx: segment.idx })
        const started = Date.now()
        const { result, attempts } = await transcribeWithRetry({ apiKey, audioBase64: wavBase64(segment.chunks), prompt })
        const latencyMs = Date.now() - started
        if (!result.ok) throw new Error(`part ${segment.idx} failed: ${result.code} ${result.detail}`)
        const rows = stitchChunkSegments({
          response: result.data,
          chunkIdx: segment.idx,
          offsetMs: segment.offsetMs,
          durationMs: segment.durationMs,
          roster,
        })
        for (const row of rows) {
          expect(row.start_ms).toBeGreaterThanOrEqual(segment.offsetMs)
          expect(row.end_ms).toBeLessThanOrEqual(segment.offsetMs + segment.durationMs)
        }
        stitched.push(...rows)
        const descriptions = new Map((result.data.speakers ?? []).map((s) => [s.label.trim(), s.description ?? null]))
        for (const label of new Set(rows.map((row) => row.speakerLabel))) {
          if (!roster.some((speaker) => speaker.label === label)) {
            roster.push({ id: `spk-${label}`, label, description: descriptions.get(label) ?? null })
          }
        }
        perPart.push({ idx: segment.idx, latencyMs, attempts, lines: rows.length, usage: result.usage })
      }
      report.perPart = perPart

      // Word error rate over the whole meeting.
      const reference = normalizeWords(SCRIPT.map(([, text]) => text).join(' '))
      const hypothesis = normalizeWords(stitched.map((row) => row.text).join(' '))
      const { errors, wer } = wordErrors(reference, hypothesis)
      report.referenceWords = reference.length
      report.hypothesisWords = hypothesis.length
      report.wordErrors = errors
      report.wer = Number(wer.toFixed(4))

      // Speaker attribution: align each line to the script utterance it overlaps most.
      const utteranceWords = SCRIPT.map(([voice, text]) => ({ voice, words: new Set(normalizeWords(text)) }))
      const aligned = stitched.map((row) => {
        const words = normalizeWords(row.text)
        let best = { voice: 'lead' as Voice, score: -1 }
        for (const utterance of utteranceWords) {
          const score = words.filter((word) => utterance.words.has(word)).length / Math.max(1, words.length)
          if (score > best.score) best = { voice: utterance.voice, score }
        }
        return { label: row.speakerLabel, voice: best.voice, weight: words.length }
      })
      const votes = new Map<string, Record<Voice, number>>()
      for (const row of aligned) {
        const entry = votes.get(row.label) ?? { lead: 0, engineer: 0 }
        entry[row.voice] += row.weight
        votes.set(row.label, entry)
      }
      const labelVoice = new Map([...votes].map(([label, v]) => [label, v.lead >= v.engineer ? 'lead' : 'engineer']))
      const totalWeight = aligned.reduce((sum, row) => sum + row.weight, 0)
      const correct = aligned.reduce((sum, row) => sum + (labelVoice.get(row.label) === row.voice ? row.weight : 0), 0)
      const speakerAccuracy = totalWeight ? correct / totalWeight : 0
      const partsPerLabel = Object.fromEntries(
        [...votes.keys()].map((label) => [
          label,
          [...new Set(stitched.filter((row) => row.speakerLabel === label).map((row) => Math.floor(row.ordinal / 10_000)))],
        ]),
      )
      report.speakerLabels = Object.fromEntries(labelVoice)
      report.speakerLabelParts = partsPerLabel
      report.speakerAccuracy = Number(speakerAccuracy.toFixed(4))
      report.transcript = stitched.map((row) => `${row.speakerLabel} @${(row.start_ms / 1000).toFixed(1)}s: ${row.text}`)

      expect(wer).toBeLessThanOrEqual(WER_LIMIT)
      expect(speakerAccuracy).toBeGreaterThanOrEqual(SPEAKER_ACCURACY_LIMIT)
      // Both voices keep a single label across parts (roster continuity).
      expect(new Set(labelVoice.values()).size).toBe(2)
      expect(votes.size).toBeLessThanOrEqual(3)
      for (const voice of ['lead', 'engineer'] as Voice[]) {
        const dominant = [...votes].sort((a, b) => b[1][voice] - a[1][voice])[0]!
        expect((partsPerLabel[dominant[0]] ?? []).length).toBe(segments.length)
      }
    },
    300_000,
  )

  it(
    'returns no transcript for silence (no hallucinated speech)',
    async () => {
      const prompt = buildTranscriptionPrompt({ roster: [], previousLines: [], languageHint: 'en', chunkIdx: 0 })
      const { result } = await transcribeWithRetry({ apiKey, audioBase64: wavBase64([silencePcm]), prompt })
      if (!result.ok) throw new Error(`silence failed: ${result.code}`)
      const words = result.data.segments.flatMap((segment) => normalizeWords(segment.text))
      report.silenceWords = words.length
      expect(words.length).toBeLessThanOrEqual(2)
    },
    60_000,
  )

  it(
    'extracts the spoken decisions and action items without inventing owners',
    async () => {
      expect(stitched.length).toBeGreaterThan(0)
      const lines: AnalysisLine[] = stitched.map((row, i) => ({
        ref: i + 1,
        segmentId: `seg-${i + 1}`,
        speakerLabel: row.speakerLabel,
        startMs: row.start_ms,
        text: row.text,
      }))
      const systemPrompt = buildAnalysisPrompt({
        title: 'Mobile app redesign planning',
        meetingDate: '2026-09-21',
        projectName: 'Mobile app',
        roster: roster.map((speaker) => ({ label: speaker.label, display_name: null })),
        locale: 'en',
      })
      const result = await callOpenRouter(
        apiKey,
        {
          model: 'google/gemini-2.5-flash',
          stream: false,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Transcript:\n${buildAnalysisTranscript(lines)}` },
          ],
        },
        'Hilm Meeting Analysis (accuracy test)',
        60_000,
      )
      if (!result.ok) throw new Error(`analysis failed: ${result.code} ${result.detail}`)
      const parsed = analysisResponseSchema.safeParse(extractJsonObject(result.content))
      expect(parsed.success).toBe(true)
      if (!parsed.success) return
      const clean = sanitizeAnalysis(parsed.data, { lines, rosterLabels: roster.map((speaker) => speaker.label) })
      report.analysis = {
        summary: clean.summary,
        decisions: clean.decisions.map((d) => `${d.certainty}: ${d.text}`),
        actions: clean.action_items.map(
          (a) => `${a.certainty}: ${a.title} | owner=${a.ownerLabel ?? '-'}(${a.owner_certainty}) | due=${a.due_text ?? '-'}`,
        ),
      }

      const decisionText = clean.decisions.map((d) => d.text.toLowerCase()).join('\n')
      expect(decisionText).toMatch(/sign ?up|email/)
      expect(decisionText).toMatch(/lazy/)

      const actionText = clean.action_items.map((a) => `${a.title} ${a.description ?? ''}`.toLowerCase())
      expect(actionText.some((text) => /wireframe/.test(text))).toBe(true)
      expect(actionText.some((text) => /omar|backend/.test(text))).toBe(true)
      expect(actionText.some((text) => /support|invit/.test(text))).toBe(true)

      // Every source ref resolves to a real transcript line; owners are real roster labels only.
      const segmentIds = new Set(lines.map((line) => line.segmentId))
      for (const item of [...clean.decisions, ...clean.action_items]) {
        for (const id of item.source_segment_ids) expect(segmentIds.has(id)).toBe(true)
      }
      const rosterLabels = new Set(roster.map((speaker) => speaker.label))
      for (const item of clean.action_items) {
        if (item.ownerLabel) expect(rosterLabels.has(item.ownerLabel)).toBe(true)
      }
      // The wireframes were promised by the engineer; if an owner is attributed it must be that voice.
      const wireframe = clean.action_items.find((a) => /wireframe/i.test(a.title))
      const labels = report.speakerLabels as Record<string, Voice>
      if (wireframe?.ownerLabel) expect(labels[wireframe.ownerLabel]).toBe('engineer')
    },
    90_000,
  )
})
