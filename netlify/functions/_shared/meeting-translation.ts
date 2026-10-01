/**
 * Meeting translation core (pure): which texts need translating, batching, prompt and
 * reply parsing. Translations are saved per meeting + target language, so each text is
 * billed once; texts already in the target language are never sent.
 */

export type TranslationTarget = 'en' | 'ar'

export type TranslationSource = { key: string; text: string }

/** Saved form: key → translated text + hash of the source it was made from. */
export type TranslationEntry = { t: string; h: string }
export type TranslationEntries = Record<string, TranslationEntry>

/** Source characters per model call; output fits comfortably inside the call deadline. */
export const MEETING_TRANSLATION_BATCH_CHARS = 6_000
/** Calls run in parallel per invocation (one usage event covers them). */
export const MEETING_TRANSLATION_PARALLEL = 3
/** Per-call wall-clock budget; the function timeout is 60 s. */
export const MEETING_TRANSLATION_DEADLINE_MS = 40_000

const ARABIC_LETTER = /[\u0621-\u064A\u0671-\u06D3]/g
const LATIN_LETTER = /[A-Za-z]/g

/**
 * FNV-1a (32-bit) of the source text, base36. Mirrored in src/shared/meetings/translation.ts
 * so the browser can tell when a saved translation no longer matches its source.
 */
export function translationSourceHash(text: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Into Arabic: a quarter or more of the letters are Latin, so brand names (Visma, Netlify)
 * inside an Arabic sentence do not trigger a call. Into English: any Arabic word counts.
 */
export function needsTranslation(text: string, target: TranslationTarget) {
  const arabic = text.match(ARABIC_LETTER)?.length ?? 0
  const latin = text.match(LATIN_LETTER)?.length ?? 0
  if (target === 'en') return arabic >= 2
  const letters = arabic + latin
  return letters > 0 && latin / letters >= 0.25
}

/** Sources that still need a (fresh) translation for this target. */
export function pendingTranslations(
  sources: TranslationSource[],
  entries: TranslationEntries,
  target: TranslationTarget,
) {
  return sources.filter((source) => {
    if (!source.text.trim() || !needsTranslation(source.text, target)) return false
    return entries[source.key]?.h !== translationSourceHash(source.text)
  })
}

/** Greedy batches by character budget, preserving order; an oversized text gets its own batch. */
export function buildTranslationBatches(sources: TranslationSource[], maxChars = MEETING_TRANSLATION_BATCH_CHARS) {
  const batches: TranslationSource[][] = []
  let current: TranslationSource[] = []
  let size = 0
  for (const source of sources) {
    const length = source.text.length + 8
    if (current.length && size + length > maxChars) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(source)
    size += length
  }
  if (current.length) batches.push(current)
  return batches
}

/** Output budget: Arabic needs more tokens per character than English. */
export function translationMaxTokens(batch: TranslationSource[], target: TranslationTarget) {
  const chars = batch.reduce((sum, item) => sum + item.text.length, 0)
  const perChar = target === 'ar' ? 0.75 : 0.45
  return Math.min(8192, 400 + Math.ceil(chars * perChar) + batch.length * 6)
}

const TARGET_NAME: Record<TranslationTarget, string> = { en: 'English', ar: 'Arabic' }

/** Static rules first (identical across calls), then the per-batch lines. */
export function buildTranslationPrompt(input: {
  target: TranslationTarget
  batch: TranslationSource[]
  title?: string | null
  projectName?: string | null
}) {
  const target = TARGET_NAME[input.target]
  const style =
    input.target === 'ar'
      ? 'Write clear, natural Arabic (simple Modern Standard Arabic a Gulf reader finds natural).'
      : 'Write clear, natural English.'
  const rules = [
    `You translate meeting text into ${target}. Each input line is "key<TAB>text".`,
    style,
    'Translate the full meaning faithfully: do not summarize, explain, add or drop anything, and keep each line separate.',
    'Keep names of people, companies, products and places, code, URLs, emails and numbers exactly as written, in their original script (for example Visma, Netlify, Milkman stay in Latin letters inside Arabic).',
    `Every line needs translating: render the whole line in ${target}, including any parts in another language. Never return a line unchanged unless it is only names or code.`,
    'Output one flat JSON object only: {"key":"translation", ...} with every key exactly once, in input order.',
  ].join('\n')
  const context = [
    input.title ? `Meeting: ${input.title}` : null,
    input.projectName ? `Project: ${input.projectName}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  const lines = input.batch.map((item) => `${item.key}\t${item.text.replace(/\s+/g, ' ').trim()}`).join('\n')
  return [rules, context, `Lines:\n${lines}`].filter(Boolean).join('\n\n')
}

/** `"key": "text"` (or `["key","text"]`) — tolerant of the bracket mix-ups models produce. */
const PAIR = /"([A-Za-z0-9:_-]{1,80})"\s*[:,]\s*("(?:[^"\\]|\\.)*")/g

/**
 * Reads {"key":"translation"}; on malformed or cut-off JSON, salvages every complete pair.
 * Unknown keys and empty translations are ignored.
 */
export function parseTranslationReply(content: string, keys: ReadonlySet<string>) {
  const result = new Map<string, string>()
  const take = (key: unknown, text: unknown) => {
    const k = String(key)
    if (!keys.has(k) || typeof text !== 'string') return
    const clean = text.trim()
    if (clean && !result.has(k)) result.set(k, clean.slice(0, 20_000))
  }
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(content.slice(start, end + 1)) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) take(key, value)
        if (result.size) return result
      }
    } catch {
      // fall through to salvage
    }
  }
  for (const match of content.matchAll(PAIR)) {
    try {
      take(match[1], JSON.parse(match[2]!))
    } catch {
      // skip a broken string literal
    }
  }
  return result
}
