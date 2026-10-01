import type { MeetingDetail } from './types'

export type TranslationTarget = 'en' | 'ar'
export type TranslationEntries = Record<string, { t: string; h: string }>

const ARABIC_LETTER = /[\u0621-\u064A\u0671-\u06D3]/g
const LATIN_LETTER = /[A-Za-z]/g

/** FNV-1a (32-bit), base36 — must match netlify/functions/_shared/meeting-translation.ts. */
export function translationSourceHash(text: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** Same rule as the server (meeting-translation.ts needsTranslation). */
export function needsTranslation(text: string, target: TranslationTarget) {
  const arabic = text.match(ARABIC_LETTER)?.length ?? 0
  const latin = text.match(LATIN_LETTER)?.length ?? 0
  if (target === 'en') return arabic >= 2
  const letters = arabic + latin
  return letters > 0 && latin / letters >= 0.25
}

/** Keys mirror the server (meeting-translator.ts loadSources). */
function translationSources(detail: MeetingDetail) {
  const sources: Array<{ key: string; text: string }> = []
  if (detail.meeting.summary) sources.push({ key: 'summary', text: detail.meeting.summary })
  detail.meeting.keyPoints.forEach((text, i) => sources.push({ key: `kp:${i}`, text }))
  for (const decision of detail.decisions) sources.push({ key: `dec:${decision.id}`, text: decision.text })
  for (const item of detail.actionItems) {
    sources.push({ key: `act:${item.id}:t`, text: item.title })
    if (item.description) sources.push({ key: `act:${item.id}:d`, text: item.description })
  }
  for (const segment of detail.transcript) sources.push({ key: segment.id, text: segment.text })
  return sources
}

/** Texts that still have no up-to-date saved translation. */
export function countPendingTranslations(detail: MeetingDetail, entries: TranslationEntries, target: TranslationTarget) {
  return translationSources(detail).filter(
    (source) =>
      source.text.trim() &&
      needsTranslation(source.text, target) &&
      entries[source.key]?.h !== translationSourceHash(source.text),
  ).length
}

/** Detail with every text that has a current saved translation swapped in; the rest stays original. */
export function applyTranslation(
  detail: MeetingDetail,
  entries: TranslationEntries,
  target: TranslationTarget,
): MeetingDetail {
  const translated = (key: string, text: string) => {
    const entry = entries[key]
    return entry && entry.h === translationSourceHash(text) ? entry.t : null
  }
  const pick = (key: string, text: string) => translated(key, text) ?? text
  const pickOptional = (key: string, text: string | null) => (text ? pick(key, text) : text)
  return {
    ...detail,
    meeting: {
      ...detail.meeting,
      summary: pickOptional('summary', detail.meeting.summary),
      keyPoints: detail.meeting.keyPoints.map((text, i) => pick(`kp:${i}`, text)),
    },
    decisions: detail.decisions.map((decision) => ({ ...decision, text: pick(`dec:${decision.id}`, decision.text) })),
    actionItems: detail.actionItems.map((item) => ({
      ...item,
      title: pick(`act:${item.id}:t`, item.title),
      description: pickOptional(`act:${item.id}:d`, item.description),
    })),
    transcript: detail.transcript.map((segment) => {
      const text = translated(segment.id, segment.text)
      return text ? { ...segment, text, language: target, languages: [target] } : segment
    }),
  }
}
