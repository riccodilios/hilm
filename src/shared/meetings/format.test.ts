import { describe, expect, it } from 'vitest'
import { textDirection, toLocalInputValue, transcriptTextMatches, transcriptTextStyle } from './format'

describe('toLocalInputValue', () => {
  it('formats in local wall-clock time', () => {
    const local = new Date(2026, 8, 30, 7, 5)
    expect(toLocalInputValue(local.toISOString())).toBe('2026-09-30T07:05')
  })

  it('returns empty for missing or invalid input', () => {
    expect(toLocalInputValue(null)).toBe('')
    expect(toLocalInputValue('not a date')).toBe('')
  })
})

describe('textDirection', () => {
  it('uses language tags when present instead of forcing whole-meeting RTL', () => {
    expect(textDirection('backend ready', 'ar-SA')).toBe('rtl')
    expect(textDirection('مرحبا بالجميع', 'en')).toBe('ltr')
    expect(textDirection('Hello team', 'en-US')).toBe('ltr')
  })

  it('falls back to script heuristics for mixed and monolingual lines', () => {
    expect(textDirection('لازم نخلص الـ backend اليوم')).toBe('rtl')
    expect(textDirection('We need to finish the API integration before Thursday.')).toBe('ltr')
    // Latin-heavy mixed line → LTR base with unicode-bidi isolate for Arabic islands
    expect(textDirection('The frontend is ready بس الـ API لسه ما خلص.')).toBe('ltr')
    // Arabic-heavy mixed line → RTL base so English tech terms nest as LTR islands
    expect(textDirection('خلينا نخلص هيدا اليوم وبكرا منبلّش بالـ testing.')).toBe('rtl')
    expect(textDirection('API v2 · IMED-42 · 10:30 AM')).toBe('ltr')
    // language:"mixed" must not lock direction — use script evidence
    expect(textDirection('خلينا نراجع الموضوع the API', 'mixed')).toBe('rtl')
    expect(textDirection("Let's discuss the new API architecture.", 'mixed')).toBe('ltr')
  })

  it('isolates bidi so mixed lines keep readable technical tokens', () => {
    const style = transcriptTextStyle('خلينا نعمل deployment على production', 'ar')
    expect(style).toEqual({ dir: 'rtl', unicodeBidi: 'isolate' })
  })
})

describe('transcriptTextMatches', () => {
  const mixed = 'لازم نخلص الـ backend اليوم وبعدين نعمل deployment على production.'

  it('finds English technical terms inside Arabic meetings', () => {
    expect(transcriptTextMatches(mixed, 'API')).toBe(false)
    expect(transcriptTextMatches(mixed, 'backend')).toBe(true)
    expect(transcriptTextMatches(mixed, 'DEPLOYMENT')).toBe(true)
    expect(transcriptTextMatches(mixed, 'production')).toBe(true)
  })

  it('finds Arabic terms with Unicode NFC', () => {
    expect(transcriptTextMatches(mixed, 'اليوم')).toBe(true)
    expect(transcriptTextMatches('راجعنا متطلبات العميل', 'العميل')).toBe(true)
  })

  it('matches English-only lines case-insensitively', () => {
    expect(
      transcriptTextMatches('We need to finish the API integration before Thursday.', 'api integration'),
    ).toBe(true)
  })
})
