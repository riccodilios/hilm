import { describe, expect, it } from 'vitest'
import {
  buildTranslationBatches,
  buildTranslationPrompt,
  needsTranslation,
  parseTranslationReply,
  pendingTranslations,
  translationMaxTokens,
  translationSourceHash,
} from './meeting-translation'
import {
  needsTranslation as clientNeedsTranslation,
  translationSourceHash as clientHash,
} from '../../../src/shared/meetings/translation'

describe('needsTranslation', () => {
  it('translates English into Arabic and Arabic into English', () => {
    expect(needsTranslation('We ship on Thursday.', 'ar')).toBe(true)
    expect(needsTranslation('نسلم يوم الخميس.', 'en')).toBe(true)
  })

  it('skips text already in the target language, even with brand names inside', () => {
    expect(needsTranslation('We ship on Thursday.', 'en')).toBe(false)
    expect(needsTranslation('نستخدم Netlify للنشر في الإنتاج اليوم', 'ar')).toBe(false)
    expect(needsTranslation('2025 — 10:30', 'ar')).toBe(false)
  })

  it('translates mixed lines that are substantially in the other language', () => {
    expect(needsTranslation('اليوم we need to review the integration.', 'ar')).toBe(true)
    expect(needsTranslation('اليوم we need to review the integration.', 'en')).toBe(true)
  })
})

describe('pendingTranslations', () => {
  const sources = [
    { key: 'a', text: 'Hello team' },
    { key: 'b', text: 'مرحبا' },
    { key: 'c', text: '   ' },
    { key: 'd', text: 'Edited title' },
  ]

  it('only sends missing or stale foreign-language texts', () => {
    const entries = {
      a: { t: 'مرحبا فريق', h: translationSourceHash('Hello team') },
      d: { t: 'قديم', h: translationSourceHash('Old title') },
    }
    expect(pendingTranslations(sources, entries, 'ar').map((s) => s.key)).toEqual(['d'])
    expect(pendingTranslations(sources, {}, 'en').map((s) => s.key)).toEqual(['b'])
  })
})

describe('hash parity', () => {
  it('matches the browser implementation', () => {
    for (const text of ['Hello', 'مرحبا بالجميع', 'Mixed نص 123 😀', '']) {
      expect(clientHash(text)).toBe(translationSourceHash(text))
      for (const target of ['en', 'ar'] as const) {
        expect(clientNeedsTranslation(text, target)).toBe(needsTranslation(text, target))
      }
    }
  })
})

describe('buildTranslationBatches', () => {
  it('splits by character budget and keeps order', () => {
    const sources = Array.from({ length: 10 }, (_, i) => ({ key: String(i), text: 'x'.repeat(92) }))
    const batches = buildTranslationBatches(sources, 300)
    expect(batches.map((b) => b.length)).toEqual([3, 3, 3, 1])
    expect(batches.flat().map((s) => s.key)).toEqual(sources.map((s) => s.key))
  })

  it('gives an oversized text its own batch', () => {
    const batches = buildTranslationBatches([{ key: 'a', text: 'x'.repeat(500) }, { key: 'b', text: 'y' }], 100)
    expect(batches.map((b) => b.map((s) => s.key))).toEqual([['a'], ['b']])
  })
})

describe('prompt and budget', () => {
  it('lists every line with its key and caps output tokens', () => {
    const batch = [
      { key: '1', text: 'Hello\nteam' },
      { key: '2', text: 'Bye' },
    ]
    const prompt = buildTranslationPrompt({ target: 'ar', batch, title: 'Sync' })
    expect(prompt).toContain('1\tHello team')
    expect(prompt).toContain('2\tBye')
    expect(prompt).toContain('Meeting: Sync')
    expect(translationMaxTokens([{ key: '1', text: 'x'.repeat(100_000) }], 'ar')).toBe(8192)
  })
})

describe('parseTranslationReply', () => {
  const keys = new Set(['1', '2', '3'])

  it('reads a flat object and ignores unknown or empty keys', () => {
    const parsed = parseTranslationReply('{"1":"أهلا","2":"","9":"x","3":"وداعا"}', keys)
    expect([...parsed]).toEqual([
      ['1', 'أهلا'],
      ['3', 'وداعا'],
    ])
  })

  it('salvages complete pairs from cut-off or bracket-mixed replies', () => {
    expect([...parseTranslationReply('{"1":"أهلا","2":"مع السلا', keys)]).toEqual([['1', 'أهلا']])
    expect([...parseTranslationReply('{"t":[["1","a"]},{"2","b \\"q\\""}', keys)]).toEqual([
      ['1', 'a'],
      ['2', 'b "q"'],
    ])
  })
})
