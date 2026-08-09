/** Speech locale helpers + transcript merge that avoids spam / duplicates. */

export type SpeechLocale = 'en-US' | 'ar-SA'

export function speechLocaleFromI18n(lng: string): SpeechLocale {
  return lng.startsWith('ar') ? 'ar-SA' : 'en-US'
}

export function isArabicLocale(lang: string) {
  return lang.toLowerCase().startsWith('ar')
}

function normalizeForCompare(text: string) {
  return text
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '') // Arabic diacritics
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Pick the best alternative: confidence first, slight bias to longer phrases. */
export function bestTranscriptAlternative(result: {
  length: number
  [index: number]: { transcript?: string; confidence?: number }
}) {
  let best = ''
  let bestScore = -1
  const n = Math.max(1, result.length || 1)
  for (let i = 0; i < n; i += 1) {
    const alt = result[i]
    const text = alt?.transcript?.trim() ?? ''
    if (!text) continue
    const confidence =
      typeof alt.confidence === 'number' && alt.confidence > 0 ? alt.confidence : 0.5 - i * 0.01
    // Prefer longer transcripts when confidence is close — short mishears often win raw confidence.
    const lengthBonus = Math.min(0.08, text.split(/\s+/).filter(Boolean).length * 0.01)
    const score = confidence + lengthBonus
    if (score > bestScore) {
      bestScore = score
      best = text
    }
  }
  return { text: best, confidence: bestScore < 0 ? 0 : bestScore }
}

/**
 * Lightweight English phrase fixes for common Web Speech confusions.
 * Skips protectTokens (project/task names) and non-letter tokens.
 */
export function applySpeechCorrections(
  text: string,
  opts?: { lang?: string; protectTokens?: string[] },
) {
  if (!text.trim()) return text
  if (isArabicLocale(opts?.lang ?? '')) return text

  const protect = new Set(
    (opts?.protectTokens ?? [])
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  )

  let next = text
  const phraseFixes: Array<[RegExp, string]> = [
    [/\bthroat the\b/gi, 'throughout the'],
    [/\bthroat our\b/gi, 'throughout our'],
    [/\ball throat\b/gi, 'all throughout'],
    [/\bthroat\b(?=\s+(the|our|this|that|my|week|day|project))/gi, 'throughout'],
  ]
  for (const [pattern, replacement] of phraseFixes) {
    next = next.replace(pattern, (match) => {
      if (protect.has(match.toLowerCase())) return match
      return replacement
    })
  }
  return next
}

/**
 * Merge a new final speech chunk into the composer text.
 * Dedupes overlaps/repeats from Web Speech keep-alive restarts and inserts
 * sentence / paragraph breaks after pauses instead of one giant run-on blob.
 */
export function mergeVoiceTranscript(
  current: string,
  addition: string,
  opts?: {
    lang?: string
    /** Ms since previous final chunk. Longer gaps → sentence/paragraph break. */
    gapMs?: number
    minConfidence?: number
    confidence?: number
    protectTokens?: string[]
  },
) {
  const corrected = applySpeechCorrections(addition.replace(/\s+/g, ' ').trim(), {
    lang: opts?.lang,
    protectTokens: opts?.protectTokens,
  })
  const next = corrected
  if (!next) return current

  const minConfidence = opts?.minConfidence ?? 0.25
  if (typeof opts?.confidence === 'number' && opts.confidence > 0 && opts.confidence < minConfidence) {
    return current
  }

  const base = current.replace(/[ \t]+$/g, '')
  if (!base) return capitalizeIfLatin(next, opts?.lang)

  const baseNorm = normalizeForCompare(base)
  const nextNorm = normalizeForCompare(next)
  if (!nextNorm) return current

  // Exact duplicate of the last chunk(s)
  if (baseNorm.endsWith(nextNorm)) return current
  // Restart re-delivered a longer version of the same utterance
  if (nextNorm.startsWith(baseNorm) && nextNorm.length > baseNorm.length) {
    return capitalizeIfLatin(next, opts?.lang)
  }
  // New chunk largely overlaps the tail of the composer (common Chrome quirk)
  const overlap = longestSuffixPrefixOverlap(baseNorm, nextNorm)
  if (overlap >= Math.min(12, nextNorm.length) || overlap / nextNorm.length >= 0.7) {
    const remainder = next.slice(Math.round((overlap / nextNorm.length) * next.length)).trim()
    if (!remainder || normalizeForCompare(remainder).length < 2) return current
    return joinWithPause(base, remainder, opts?.gapMs, opts?.lang)
  }

  return joinWithPause(base, next, opts?.gapMs, opts?.lang)
}

function longestSuffixPrefixOverlap(a: string, b: string) {
  const max = Math.min(a.length, b.length)
  for (let len = max; len > 0; len -= 1) {
    if (a.slice(-len) === b.slice(0, len)) return len
  }
  return 0
}

function joinWithPause(base: string, next: string, gapMs: number | undefined, lang?: string) {
  const gap = gapMs ?? 0
  let separator = ' '
  if (gap >= 2200) separator = '\n\n'
  else if (gap >= 1100) {
    // Sentence break when the previous chunk didn't already end with punctuation
    if (/[.!?…۔؟]$/.test(base.trimEnd()) || /[\n]$/.test(base)) separator = ' '
    else separator = isArabicLocale(lang ?? '') ? '. ' : '. '
  }

  const piece =
    separator === '. ' || separator === '\n\n' ? capitalizeIfLatin(next, lang) : next
  if (separator === '. ' && /[.!?…۔؟]$/.test(base.trimEnd())) {
    return `${base.trimEnd()} ${piece}`
  }
  return `${base.trimEnd()}${separator}${piece}`
}

function capitalizeIfLatin(text: string, lang?: string) {
  if (isArabicLocale(lang ?? '')) return text
  if (!/^[a-z]/.test(text)) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}
