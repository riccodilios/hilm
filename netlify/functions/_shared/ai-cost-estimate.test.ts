import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  estimateCostTable,
  estimateMeetingPipelineCost,
  projectSttUsage,
  type MeasuredPerMinute,
} from './ai-cost-estimate'
import { splitTranscriptWindows, hashAnalysisInput } from './meeting-analysis'
import { getAiRuntimeConfig } from './ai-config'
import { trimChatHistory } from './ai-gateway'
import type { AnalysisLine } from './meeting-core'

type BenchmarkFile = {
  scenarios: Array<{ name: string; sttPerAudioMinute: MeasuredPerMinute; quality: { wer: number; speakerAccuracy: number } }>
}

function benchmark(label: string): BenchmarkFile {
  return JSON.parse(readFileSync(`benchmarks/meeting-ai/${label}.json`, 'utf8')) as BenchmarkFile
}

describe('meeting cost estimates (measured rates)', () => {
  it('shows STT dominates cost for 15–120 minute meetings', () => {
    const table = estimateCostTable([15, 30, 60, 120])
    expect(table.map((row) => [row.durationMinutes, row.segmentCount])).toEqual([
      [15, 10],
      [30, 20],
      [60, 40],
      [120, 80],
    ])
    for (const row of table) {
      expect(row.segmentCount).toBe(Math.ceil((row.durationMinutes * 60) / 90))
      expect(row.transcriptionEstimatedUsd).toBeGreaterThan(row.analysisDirectEstimatedUsd)
      expect(row.totalTranscriptionPlusDirectUsd).toBeGreaterThan(0)
    }
    const hour = table.find((row) => row.durationMinutes === 60)!
    // 90,000 audio + 33,200 prompt + 24,000 output tokens ≈ $0.16 per hour of audio at list price.
    expect(hour.transcriptionTokens).toBe(147_200)
    expect(hour.transcriptionEstimatedUsd).toBeCloseTo(0.16, 2)
  })

  it('silence trimming lowers only the audio share', () => {
    const full = estimateMeetingPipelineCost({ durationMinutes: 60 })
    const trimmed = estimateMeetingPipelineCost({ durationMinutes: 60, sentAudioRatio: 0.86 })
    expect(trimmed.transcriptionAudioTokens).toBe(Math.ceil(3600 * 0.86 * 25))
    expect(trimmed.transcriptionPromptTokens).toBe(full.transcriptionPromptTokens)
    expect(trimmed.transcriptionOutputTokens).toBe(full.transcriptionOutputTokens)
  })
})

describe('benchmark-backed STT projections (no live calls)', () => {
  const baseline = benchmark('baseline')
  const optimized = benchmark('optimized')

  it('optimized per-minute STT usage is below baseline in every scenario without losing quality', () => {
    for (const before of baseline.scenarios) {
      const after = optimized.scenarios.find((s) => s.name === before.name)!
      expect(after.sttPerAudioMinute.totalTokens).toBeLessThan(before.sttPerAudioMinute.totalTokens)
      expect(after.sttPerAudioMinute.completionTokens).toBeLessThan(before.sttPerAudioMinute.completionTokens)
      // Quality guard: WER within 0.01 absolute and speaker accuracy within 0.01 of the baseline.
      expect(after.quality.wer).toBeLessThanOrEqual(before.quality.wer + 0.01)
      expect(after.quality.speakerAccuracy).toBeGreaterThanOrEqual(before.quality.speakerAccuracy - 0.01)
    }
  })

  it('projects 5 min to 5 h linearly from measured per-minute usage', () => {
    for (const minutes of [5, 15, 30, 60, 180, 300]) {
      for (const before of baseline.scenarios) {
        const after = optimized.scenarios.find((s) => s.name === before.name)!
        const b = projectSttUsage(before.sttPerAudioMinute, minutes)
        const a = projectSttUsage(after.sttPerAudioMinute, minutes)
        expect(a.totalTokens).toBeLessThan(b.totalTokens)
        expect(b.totalTokens).toBe(Math.round(before.sttPerAudioMinute.totalTokens * minutes))
      }
    }
  })

  it('uses hierarchical analysis token estimate for long transcripts', () => {
    const short = estimateMeetingPipelineCost({ durationMinutes: 15 })
    const long = estimateMeetingPipelineCost({ durationMinutes: 120 })
    expect(long.analysisHierarchicalEstimatedUsd).toBeGreaterThan(0)
    expect(long.segmentCount).toBeGreaterThan(short.segmentCount)
  })
})

describe('hierarchical transcript windows', () => {
  it('splits without dropping lines and respects char budget', () => {
    const lines: AnalysisLine[] = Array.from({ length: 40 }, (_, i) => ({
      ref: i + 1,
      segmentId: `s${i}`,
      speakerLabel: 'Speaker 1',
      startMs: i * 1000,
      text: 'A'.repeat(200),
    }))
    const windows = splitTranscriptWindows(lines, 2_500)
    expect(windows.length).toBeGreaterThan(1)
    expect(windows.flat().length).toBe(40)
    expect(hashAnalysisInput(lines)).toHaveLength(64)
    expect(hashAnalysisInput(lines)).toBe(hashAnalysisInput(lines))
  })
})

describe('AI runtime config + chat history trim', () => {
  it('exposes kill switches and model routing defaults', () => {
    const config = getAiRuntimeConfig()
    expect(config.aiEnabled).toBe(true)
    expect(config.transcriptionEnabled).toBe(true)
    expect(config.models.meeting_transcription).toContain('gemini')
    expect(config.chat.maxHistoryMessages).toBeLessThanOrEqual(16)
    expect(config.meeting.directAnalysisMaxChars).toBeGreaterThan(10_000)
  })

  it('truncates long chat history messages', () => {
    const trimmed = trimChatHistory(
      [
        { role: 'user', content: 'x'.repeat(5_000) },
        { role: 'assistant', content: 'ok' },
      ],
      { maxMessages: 10, maxCharsPerMessage: 100 },
    )
    expect(trimmed).toHaveLength(2)
    expect(trimmed[0]!.content.length).toBeLessThan(5_000)
    expect(trimmed[0]!.content).toMatch(/truncated for length/)
  })
})
