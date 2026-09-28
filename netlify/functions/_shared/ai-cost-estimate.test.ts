import { describe, expect, it } from 'vitest'
import {
  estimateCostTable,
  estimateMeetingPipelineCost,
} from './ai-cost-estimate'
import { splitTranscriptWindows, hashAnalysisInput } from './meeting-analysis'
import { getAiRuntimeConfig } from './ai-config'
import { trimChatHistory } from './ai-gateway'
import type { AnalysisLine } from './meeting-core'

describe('meeting cost estimates (bookkeeping rates)', () => {
  it('shows STT dominates cost for 15–120 minute meetings', () => {
    const table = estimateCostTable([15, 30, 60, 120])
    for (const row of table) {
      expect(row.segmentCount).toBe(Math.ceil((row.durationMinutes * 60) / 90))
      // Audio STT is the primary driver vs analysis for typical lengths.
      expect(row.transcriptionEstimatedUsd).toBeGreaterThan(row.analysisDirectEstimatedUsd)
      expect(row.totalTranscriptionPlusDirectUsd).toBeGreaterThan(0)
    }
    const hour = table.find((row) => row.durationMinutes === 60)!
    // Sanity band for current bookkeeping rates (~$0.10–$0.30 / hour audio-heavy).
    expect(hour.transcriptionEstimatedUsd).toBeGreaterThan(0.05)
    expect(hour.transcriptionEstimatedUsd).toBeLessThan(1.5)
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
