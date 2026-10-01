/** Saved English <-> Arabic meeting translation: translate only what is missing, bill once. */
import { featureDisabledMessage } from './ai-config'
import { runAiCompletion, hashStable } from './ai-gateway'
import { beginAiRequest, completeAiRequest } from './ai-guard'
import { loadEffectiveAiConfig } from './ai-runtime-db'
import { meetingTables } from './meeting-core'
import type { EngineContext, MeetingRow } from './meeting-engine'
import {
  MEETING_TRANSLATION_DEADLINE_MS,
  MEETING_TRANSLATION_PARALLEL,
  buildTranslationBatches,
  buildTranslationPrompt,
  parseTranslationReply,
  pendingTranslations,
  translationMaxTokens,
  translationSourceHash,
  type TranslationEntries,
  type TranslationSource,
  type TranslationTarget,
} from './meeting-translation'

export type TranslateResult =
  | { ok: true; state: 'translated' | 'busy'; done: boolean; remaining: number }
  | { ok: false; code: string; message: string; status: number }

function translationTable(ctx: EngineContext) {
  return ctx.os === 'workspace' ? 'workspace_meeting_translations' : 'meeting_translations'
}

/** Every translatable text of a finished meeting, keyed stably (ids survive re-renders). */
async function loadSources(ctx: EngineContext, meetingId: string): Promise<TranslationSource[]> {
  const tables = meetingTables(ctx.os)
  const transcript: Array<{ id: string; text: string }> = []
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await ctx.client
      .from(tables.transcript)
      .select('id, text')
      .eq('meeting_id', meetingId)
      .order('ordinal', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    transcript.push(...((data ?? []) as Array<{ id: string; text: string }>))
    if (!data || data.length < 1000) break
  }
  const [meetingResult, decisionsResult, actionsResult] = await Promise.all([
    ctx.client.from(tables.meetings).select('summary, key_points').eq('id', meetingId).maybeSingle(),
    ctx.client.from(tables.decisions).select('id, text').eq('meeting_id', meetingId).order('ordinal'),
    ctx.client.from(tables.actions).select('id, title, description').eq('meeting_id', meetingId).order('ordinal'),
  ])
  for (const result of [meetingResult, decisionsResult, actionsResult]) {
    if (result.error) throw new Error(result.error.message)
  }
  const meeting = meetingResult.data as { summary: string | null; key_points: unknown } | null
  const sources: TranslationSource[] = []
  if (meeting?.summary) sources.push({ key: 'summary', text: meeting.summary })
  if (Array.isArray(meeting?.key_points)) {
    meeting.key_points.forEach((point, i) => {
      if (typeof point === 'string') sources.push({ key: `kp:${i}`, text: point })
    })
  }
  for (const row of (decisionsResult.data ?? []) as Array<{ id: string; text: string }>) {
    sources.push({ key: `dec:${row.id}`, text: row.text })
  }
  for (const row of (actionsResult.data ?? []) as Array<{ id: string; title: string; description: string | null }>) {
    sources.push({ key: `act:${row.id}:t`, text: row.title })
    if (row.description) sources.push({ key: `act:${row.id}:d`, text: row.description })
  }
  for (const row of transcript) sources.push({ key: row.id, text: row.text })
  return sources
}

/**
 * One invocation: up to MEETING_TRANSLATION_PARALLEL batches of missing texts under a single
 * usage event, merged into the saved row. The client calls again while `done` is false.
 */
export async function translateMeeting(
  ctx: EngineContext,
  meeting: MeetingRow,
  target: TranslationTarget,
): Promise<TranslateResult> {
  if (meeting.status !== 'ready') {
    return { ok: false, code: 'not_ready', message: 'The meeting is still processing.', status: 409 }
  }
  const runtime = await loadEffectiveAiConfig(ctx.client)
  if (!runtime.aiEnabled || !runtime.analysisEnabled) {
    return { ok: false, code: 'disabled', message: featureDisabledMessage('meeting_translate'), status: 403 }
  }

  const table = translationTable(ctx)
  const scope = ctx.os === 'workspace' ? { workspace_id: meeting.workspace_id } : { user_id: meeting.user_id }
  const [sources, savedResult] = await Promise.all([
    loadSources(ctx, meeting.id),
    ctx.client.from(table).select('id, entries').eq('meeting_id', meeting.id).eq('target_language', target).maybeSingle(),
  ])
  if (savedResult.error) throw new Error(savedResult.error.message)
  let saved = savedResult.data as { id: string; entries: TranslationEntries | null } | null
  const entries: TranslationEntries = saved?.entries ?? {}
  const pending = pendingTranslations(sources, entries, target)
  if (!pending.length) return { ok: true, state: 'translated', done: true, remaining: 0 }

  // Prove write access before spending anything (workspace viewers cannot save translations).
  if (!saved) {
    const { data, error } = await ctx.client
      .from(table)
      .upsert({ ...scope, meeting_id: meeting.id, target_language: target }, { onConflict: 'meeting_id,target_language' })
      .select('id, entries')
      .maybeSingle()
    if (error || !data) {
      return { ok: false, code: 'forbidden', message: 'You do not have permission to translate this meeting.', status: 403 }
    }
    saved = data as { id: string; entries: TranslationEntries | null }
  } else {
    const { data } = await ctx.client.from(table).update({ target_language: target }).eq('id', saved.id).select('id')
    if (!data?.length) {
      return { ok: false, code: 'forbidden', message: 'You do not have permission to translate this meeting.', status: 403 }
    }
  }

  const batches: TranslationSource[][] = buildTranslationBatches(pending).slice(0, MEETING_TRANSLATION_PARALLEL)
  const model = runtime.models.meeting_translate
  const workHash = hashStable(
    batches.flat().map((source) => `${source.key}:${translationSourceHash(source.text)}`).join('|'),
  ).slice(0, 24)
  const baseKey = `meeting:${meeting.id}:tr:${target}:${workHash}`
  const begin = (key: string) =>
    beginAiRequest(ctx.client, {
      requestKind: 'meeting_translate',
      model,
      workspaceId: ctx.os === 'workspace' ? meeting.workspace_id : null,
      idempotencyKey: key,
      fingerprint: `meeting:${meeting.id}:tr:${target}`,
    })

  let guard = await begin(baseKey)
  if (!guard.ok && guard.code === 'duplicate' && guard.status === 'completed') {
    // Same work billed but never saved (killed mid-save): one recovery attempt only.
    guard = await begin(`${baseKey}:orphan`)
  }
  if (!guard.ok) {
    if (
      guard.code === 'in_flight' ||
      guard.code === 'duplicate_execution' ||
      (guard.code === 'duplicate' && guard.status === 'started')
    ) {
      return { ok: true, state: 'busy', done: false, remaining: pending.length }
    }
    return {
      ok: false,
      code: guard.code || 'ai_limit',
      message: guard.message || "You've reached your AI usage limit for today.",
      status: guard.code === 'tier_disabled' ? 403 : 429,
    }
  }
  const eventId = guard.event_id ?? null

  const results = await Promise.all(
    batches.map(async (batch) => {
      // Short per-call keys keep the prompt and reply small; mapped back after parsing.
      const local = batch.map((source, i) => ({ key: String(i + 1), text: source.text }))
      const result = await runAiCompletion({
        apiKey: ctx.apiKey,
        feature: 'meeting_translate',
        model,
        messages: [{ role: 'user', content: buildTranslationPrompt({ target, batch: local, title: meeting.title }) }],
        maxTokens: translationMaxTokens(local, target),
        temperature: 0,
        responseFormat: { type: 'json_object' },
        timeoutMs: MEETING_TRANSLATION_DEADLINE_MS,
        allowRetry: false,
        title: 'Hilm meeting translation',
      })
      const translated = new Map<string, string>()
      if (result.ok) {
        const parsed = parseTranslationReply(result.content, new Set(local.map((item) => item.key)))
        const returned = batch.flatMap((source, i) => {
          const text = parsed.get(String(i + 1))
          return text ? [{ source, text, same: text === source.text.trim() }] : []
        })
        // A reply echoing most lines back untranslated is a model failure, not a translation;
        // a short line (names, "API") may legitimately stay the same.
        const changed = returned.filter((item) => !item.same).length
        for (const item of returned) {
          if (!item.same || changed * 2 >= returned.length || item.text.split(/\s+/).length <= 4) {
            translated.set(item.source.key, item.text)
          }
        }
      }
      return { result, translated }
    }),
  )

  let inputTokens = 0
  let outputTokens = 0
  let costUsd: number | null = null
  const fresh: TranslationEntries = {}
  const textByKey = new Map(batches.flat().map((source) => [source.key, source.text]))
  for (const { result, translated } of results) {
    if (result.tokens) {
      inputTokens += result.tokens.inputTokens
      outputTokens += result.tokens.outputTokens
      if (typeof result.tokens.costUsd === 'number') costUsd = (costUsd ?? 0) + result.tokens.costUsd
    }
    for (const [key, text] of translated) {
      fresh[key] = { t: text, h: translationSourceHash(textByKey.get(key)!) }
    }
  }
  const translatedCount = Object.keys(fresh).length
  const complete = (status: 'completed' | 'failed', error?: { code: string; message: string }) =>
    eventId
      ? completeAiRequest(ctx.client, {
          eventId,
          status,
          model,
          inputTokens,
          outputTokens,
          costUsd,
          errorCode: error?.code ?? null,
          errorMessage: error?.message.slice(0, 500) ?? null,
        })
      : Promise.resolve()

  if (!translatedCount) {
    const failure = results.find((item) => !item.result.ok)?.result
    const code = failure && !failure.ok ? failure.code : 'parse_error'
    await complete('failed', { code, message: failure && !failure.ok ? failure.detail : 'No usable translation returned' })
    return {
      ok: false,
      code: code === 'disabled' ? 'disabled' : 'translation_failed',
      message:
        code === 'disabled'
          ? featureDisabledMessage('meeting_translate')
          : code === 'rate_limited'
            ? 'The translation service is busy. Please try again in a moment.'
            : 'Translation failed. Please try again.',
      status: code === 'disabled' ? 403 : code === 'rate_limited' ? 429 : 502,
    }
  }

  // Drop entries whose source no longer exists (re-transcribed segments, removed items).
  const liveKeys = new Set(sources.map((source) => source.key))
  const merged: TranslationEntries = {}
  for (const [key, entry] of Object.entries({ ...(saved.entries ?? {}), ...fresh })) {
    if (liveKeys.has(key)) merged[key] = entry
  }
  const { error: saveError } = await ctx.client.from(table).update({ entries: merged, model }).eq('id', saved.id)
  if (saveError) {
    await complete('failed', { code: 'save_error', message: saveError.message })
    return { ok: false, code: 'save_error', message: 'Could not save the translation. Please try again.', status: 500 }
  }
  await complete('completed')

  const remaining = pendingTranslations(sources, merged, target).length
  return { ok: true, state: 'translated', done: remaining === 0, remaining }
}
