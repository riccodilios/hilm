/** Speech locale helpers + session transcript merge (no blind append of interim). */

export type SpeechLocale = 'en-US' | 'ar-SA'

export function speechLocaleFromI18n(lng: string): SpeechLocale {
  return lng.startsWith('ar') ? 'ar-SA' : 'en-US'
}

export function isArabicLocale(lang: string) {
  return lang.toLowerCase().startsWith('ar')
}

export function normalizeForCompare(text: string) {
  return text
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '') // Arabic diacritics
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Join speech segments with a single space (Web Speech often includes trailing spaces). */
export function concatSpeechSegments(...parts: string[]) {
  return parts
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .trim()
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
 * Rebuild committed + interim from a SpeechRecognition results list.
 * Always scan the full list (not only resultIndex) so iOS/Safari revisions
 * of the same result slot do not get appended multiple times.
 */
export function rebuildRecognitionTranscript(
  results: ArrayLike<{
    isFinal: boolean
    length: number
    [index: number]: { transcript?: string; confidence?: number }
  }>,
) {
  const finals: string[] = []
  const interims: string[] = []
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    if (!result) continue
    const { text } = bestTranscriptAlternative(result)
    if (!text) continue
    if (result.isFinal) finals.push(text)
    else interims.push(text)
  }
  return {
    recognitionCommitted: concatSpeechSegments(...finals),
    interim: concatSpeechSegments(...interims),
  }
}

/**
 * Merge a recognition-instance committed string into the listening-session anchor.
 * Prevents keep-alive / mobile restarts from re-inserting the same utterance.
 */
export function mergeRecognitionIntoSession(anchor: string, recognitionCommitted: string) {
  const next = recognitionCommitted.replace(/\s+/g, ' ').trim()
  if (!next) return anchor.replace(/\s+/g, ' ').trim()
  const base = anchor.replace(/\s+/g, ' ').trim()
  if (!base) return next

  const baseNorm = normalizeForCompare(base)
  const nextNorm = normalizeForCompare(next)
  if (!nextNorm) return base

  // Exact re-delivery of text already at the end
  if (baseNorm === nextNorm || baseNorm.endsWith(nextNorm)) return base
  // Engine re-delivered a longer revision of the whole utterance so far
  if (nextNorm.startsWith(baseNorm) && nextNorm.length > baseNorm.length) return next
  // Engine echoed a prefix already present
  if (nextNorm.length >= 8 && baseNorm.includes(nextNorm)) return base

  const overlap = longestSuffixPrefixOverlap(baseNorm, nextNorm)
  if (overlap >= Math.min(12, nextNorm.length) || (nextNorm.length > 0 && overlap / nextNorm.length >= 0.7)) {
    const ratio = nextNorm.length ? overlap / nextNorm.length : 0
    const remainder = next.slice(Math.round(ratio * next.length)).trim()
    if (!remainder || normalizeForCompare(remainder).length < 2) return base
    return concatSpeechSegments(base, remainder)
  }

  return concatSpeechSegments(base, next)
}

/**
 * Combine existing field text with the current listening-session voice preview.
 * Voice portion fully replaces prior voice for this session (committed + interim).
 */
export function composeVoiceFieldValue(
  baseText: string,
  committed: string,
  interim = '',
  opts?: { lang?: string },
) {
  const voice = concatSpeechSegments(committed, interim)
  if (!voice) return baseText
  if (!baseText.trim()) return capitalizeIfLatin(applySpeechCorrections(voice, opts), opts?.lang)

  const base = baseText.replace(/[ \t]+$/g, '')
  const corrected = applySpeechCorrections(voice, opts)
  const needsSpace = !/\s$/.test(base) && !/^[\s.,!?;:]/.test(corrected)
  return `${base}${needsSpace ? ' ' : ''}${corrected}`
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
 * @deprecated Prefer composeVoiceFieldValue with session committed/interim.
 * Kept for any leftover callers; still overlap-safe for chunk merges.
 */
export function mergeVoiceTranscript(
  current: string,
  addition: string,
  opts?: {
    lang?: string
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
  if (!corrected) return current

  const minConfidence = opts?.minConfidence ?? 0.25
  if (typeof opts?.confidence === 'number' && opts.confidence > 0 && opts.confidence < minConfidence) {
    return current
  }

  const base = current.replace(/[ \t]+$/g, '')
  if (!base) return capitalizeIfLatin(corrected, opts?.lang)

  const merged = mergeRecognitionIntoSession(base, corrected)
  if (merged === base) return current
  if (normalizeForCompare(merged) === normalizeForCompare(corrected)) {
    return capitalizeIfLatin(corrected, opts?.lang)
  }
  return joinWithPause(base, corrected, opts?.gapMs, opts?.lang)
}

export function htmlToPlainText(html: string) {
  const trimmed = html.trim()
  if (!trimmed) return ''
  if (typeof document !== 'undefined') {
    const el = document.createElement('div')
    el.innerHTML = trimmed
    return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  return trimmed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function plainTextToEditorHtml(text: string) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim()
  if (!escaped) return ''
  return escaped
    .split(/\n\n+/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('')
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
    if (/[.!?…۔؟]$/.test(base.trimEnd()) || /[\n]$/.test(base)) separator = ' '
    else separator = '. '
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
