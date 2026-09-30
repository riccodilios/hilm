import { describe, expect, it } from 'vitest'
import { collapseRepeatedPhrases, salvageTruncatedTranscription } from './meeting-core'
import { parseTranscriptionContent } from './meeting-transcriber'

const seg = (speaker: string, start: number, text: string) =>
  JSON.stringify({ speaker, start, end: start + 3, text, language: 'mixed', languages: ['ar', 'en'] })

describe('parseTranscriptionContent', () => {
  it('parses a complete reply unchanged', () => {
    const content = `{"segments":[${seg('Speaker 1', 0, 'مرحبا، today we start.')}],"speakers":[]}`
    const data = parseTranscriptionContent(content)
    expect(data?.segments).toHaveLength(1)
    expect(data?.segments[0]?.text).toBe('مرحبا، today we start.')
  })

  it('salvages the complete segments of a reply cut off at max_tokens', () => {
    const content = `{"segments":[${seg('Speaker 1', 0, 'خلينا نراجع the API integration')},${seg(
      'Speaker 2',
      3,
      'Okay, "quoted" {braces} inside',
    )},{"speaker":"Speaker 1","start":6,"text":"وبعدها نرسل ال`
    const data = parseTranscriptionContent(content)
    expect(data?.segments.map((s) => s.text)).toEqual([
      'خلينا نراجع the API integration',
      'Okay, "quoted" {braces} inside',
    ])
  })

  it('returns null when nothing usable was produced', () => {
    expect(parseTranscriptionContent('{"segments":[{"speaker":"Speaker 1","sta')).toBeNull()
    expect(parseTranscriptionContent('I cannot transcribe this.')).toBeNull()
    expect(salvageTruncatedTranscription('{"speakers":[]}')).toBeNull()
  })

  it('drops a runaway loop of repeated segments', () => {
    const loop = Array.from({ length: 40 }, (_, i) => seg('Speaker 1', 10 + i, 'we need to check the database'))
    const content = `{"segments":[${seg('Speaker 2', 0, 'Start of the call')},${loop.join(',')}`
    const data = parseTranscriptionContent(content)
    expect(data?.segments.map((s) => s.text)).toEqual(['Start of the call', 'we need to check the database'])
  })

  it('keeps short genuine repeats like "yes" or "okay"', () => {
    const content = `{"segments":[${seg('Speaker 1', 0, 'Okay')},${seg('Speaker 2', 1, 'Okay')},${seg('Speaker 1', 2, 'Okay')}]}`
    expect(parseTranscriptionContent(content)?.segments).toHaveLength(3)
  })
})

describe('collapseRepeatedPhrases', () => {
  it('collapses a phrase looped inside one segment', () => {
    const looped = `So the plan is ${Array(30).fill('نرسل التقرير بكرة الصبح').join(' ')}`
    expect(collapseRepeatedPhrases(looped)).toBe('So the plan is نرسل التقرير بكرة الصبح')
  })

  it('leaves natural speech with light repetition alone', () => {
    const text = 'I think, I think we should ship it. We should ship it today, yes.'
    expect(collapseRepeatedPhrases(text)).toBe(text)
  })

  it('stays fast on long non-repeating text', () => {
    const words = Array.from({ length: 4000 }, (_, i) => `word${i}`).join(' ')
    const t = Date.now()
    expect(collapseRepeatedPhrases(words)).toBe(words)
    expect(Date.now() - t).toBeLessThan(500)
  })
})
