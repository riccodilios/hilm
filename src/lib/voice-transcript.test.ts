import { describe, expect, it } from 'vitest'
import {
  composeVoiceFieldValue,
  mergeRecognitionIntoSession,
  rebuildRecognitionTranscript,
} from '@/lib/voice-transcript'

function fakeResult(text: string, isFinal: boolean, confidence = 0.9) {
  return {
    isFinal,
    length: 1,
    0: { transcript: text, confidence },
  }
}

describe('rebuildRecognitionTranscript', () => {
  it('rebuilds evolving finals without appending prefixes', () => {
    // iOS-style: same slot revises with isFinal true each time — consumer rebuilds full list
    const first = rebuildRecognitionTranscript([fakeResult('hello', true)])
    expect(first.recognitionCommitted).toBe('hello')
    expect(first.interim).toBe('')

    const second = rebuildRecognitionTranscript([fakeResult('hello just', true)])
    expect(second.recognitionCommitted).toBe('hello just')

    const third = rebuildRecognitionTranscript([fakeResult('hello just just', true)])
    expect(third.recognitionCommitted).toBe('hello just just')
  })

  it('keeps interim separate from committed', () => {
    const rebuilt = rebuildRecognitionTranscript([
      fakeResult('hello', true),
      fakeResult('test test', false),
    ])
    expect(rebuilt.recognitionCommitted).toBe('hello')
    expect(rebuilt.interim).toBe('test test')
  })

  it('joins continuous final segments once', () => {
    const rebuilt = rebuildRecognitionTranscript([
      fakeResult('hello ', true),
      fakeResult('test ', true),
      fakeResult('test', true),
    ])
    expect(rebuilt.recognitionCommitted).toBe('hello test test')
  })
})

describe('mergeRecognitionIntoSession', () => {
  it('does not re-append keep-alive echoes', () => {
    expect(mergeRecognitionIntoSession('hello test test', 'hello test test')).toBe(
      'hello test test',
    )
    expect(mergeRecognitionIntoSession('hello test test', 'test test')).toBe('hello test test')
  })

  it('appends genuinely new speech after a pause', () => {
    expect(mergeRecognitionIntoSession('Create a task called test', 'Make it high priority')).toBe(
      'Create a task called test Make it high priority',
    )
  })

  it('extends when recognition redelivers a longer revision', () => {
    expect(mergeRecognitionIntoSession('hello', 'hello test test')).toBe('hello test test')
  })
})

describe('composeVoiceFieldValue', () => {
  it('preserves existing typed text', () => {
    expect(composeVoiceFieldValue('Fix the dashboard', 'and test it on mobile')).toBe(
      'Fix the dashboard and test it on mobile',
    )
  })

  it('allows intentional repetition', () => {
    expect(composeVoiceFieldValue('', 'test test')).toBe('Test test')
  })

  it('shows interim without baking it into committed base', () => {
    expect(composeVoiceFieldValue('Note:', 'hello', 'test')).toBe('Note: hello test')
  })
})
