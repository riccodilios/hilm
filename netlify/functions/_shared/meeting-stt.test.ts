import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashAnalysisInput, type AnalysisStepResult, type executeAnalysisStep } from './meeting-analysis'
import {
  advanceMeeting,
  analyzeMeeting,
  loadMeeting,
  retryMeeting,
  type EngineContext,
  type StepResult,
} from './meeting-engine'
import { buildWavHeader, planSonioxWindows, sonioxReference, type SonioxAudioPart } from './meeting-soniox'
import { resolveSonioxKey, submitSonioxJob } from './meeting-stt'
import type { SonioxClient, SonioxFailure, SonioxToken } from './soniox'

// ── In-memory Supabase fake (no network) ────────────────────────────────────

type Row = Record<string, unknown>
type RpcHandler = (args: Record<string, unknown>) => unknown

class FakeDb {
  tables = new Map<string, Row[]>()
  legacyTables = new Set<string>()
  storage = new Map<string, Uint8Array>()
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  inserts: Array<{ table: string; rows: Row[] }> = []
  rpcHandlers: Record<string, RpcHandler> = {}
  private nextId = 1
  private nextEvent = 1

  rows(table: string) {
    if (!this.tables.has(table)) this.tables.set(table, [])
    return this.tables.get(table)!
  }
  id(prefix: string) {
    return `${prefix}-${this.nextId++}`
  }
  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args })
    const handler = this.rpcHandlers[name]
    if (handler) return Promise.resolve({ data: handler(args), error: null })
    if (name === 'begin_ai_request') {
      return Promise.resolve({ data: { ok: true, event_id: `evt-${this.nextEvent++}` }, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }
  calls(name: string) {
    return this.rpcCalls.filter((call) => call.name === name).map((call) => call.args)
  }
  client(): SupabaseClient {
    const fake = {
      from: (table: string) => new FakeQuery(this, table),
      rpc: (name: string, args: Record<string, unknown> = {}) => this.rpc(name, args),
      storage: {
        from: () => ({
          download: async (path: string) => {
            const bytes = this.storage.get(path)
            return bytes ? { data: new Blob([bytes as Uint8Array<ArrayBuffer>]), error: null } : { data: null, error: { message: 'missing' } }
          },
        }),
      },
    }
    return fake as unknown as SupabaseClient
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private op: 'select' | 'update' | 'insert' | 'delete' | 'upsert' = 'select'
  private filters: Array<(row: Row) => boolean> = []
  private payload: unknown = null
  private columns = ''
  private returning = false
  private single = false
  private orderKey: string | null = null
  private rangeWindow: [number, number] | null = null
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {}

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(columns = '*') {
    if (this.op === 'select') this.columns = columns
    else this.returning = true
    return this
  }
  update(patch: Row) {
    this.op = 'update'
    this.payload = patch
    return this
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    return this
  }
  upsert(rows: Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert'
    this.payload = rows
    this.upsertOptions = options
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value)
    return this
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }
  gt(column: string, value: number) {
    this.filters.push((row) => Number(row[column]) > value)
    return this
  }
  gte(column: string, value: number) {
    this.filters.push((row) => Number(row[column]) >= value)
    return this
  }
  lt(column: string, value: number) {
    this.filters.push((row) => Number(row[column]) < value)
    return this
  }
  not(column: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) this.filters.push((row) => (row[column] ?? null) !== null)
    return this
  }
  /** PostgREST `or` claim filters are not modelled; the other CAS filters still apply. */
  or() {
    return this
  }
  order(column: string) {
    this.orderKey = column
    return this
  }
  range(from: number, to: number) {
    this.rangeWindow = [from, to]
    return this
  }
  limit() {
    return this
  }
  maybeSingle() {
    this.single = true
    return this
  }
  then<A, B>(
    resolve?: ((value: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ) {
    return Promise.resolve(this.exec()).then(resolve, reject)
  }

  private exec(): { data: unknown; error: { message: string } | null } {
    const rows = this.db.rows(this.table)
    if (this.op === 'select' && this.db.legacyTables.has(this.table) && this.columns.includes('stt_')) {
      return { data: null, error: { message: `column ${this.table}.stt_provider does not exist` } }
    }
    let match = rows.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.orderKey) {
      const key = this.orderKey
      match.sort((a, b) => Number(a[key] ?? 0) - Number(b[key] ?? 0))
    }
    if (this.rangeWindow && this.op === 'select') match = match.slice(this.rangeWindow[0], this.rangeWindow[1] + 1)
    switch (this.op) {
      case 'select': {
        const data = this.single ? (match[0] ? { ...match[0] } : null) : match.map((row) => ({ ...row }))
        return { data, error: null }
      }
      case 'update': {
        for (const row of match) Object.assign(row, this.payload as Row, { updated_at: new Date().toISOString() })
        if (!this.returning) return { data: null, error: null }
        const data = this.single ? (match[0] ? { id: match[0].id } : null) : match.map((row) => ({ id: row.id }))
        return { data, error: null }
      }
      case 'insert': {
        const inserted = (this.payload as Row[]).map((row) => ({ id: this.db.id(this.table), ...row }))
        rows.push(...inserted)
        this.db.inserts.push({ table: this.table, rows: inserted })
        return { data: null, error: null }
      }
      case 'upsert': {
        const keys = (this.upsertOptions.onConflict ?? 'id').split(',')
        for (const row of this.payload as Row[]) {
          const existing = rows.find((other) => keys.every((key) => other[key] === row[key]))
          if (existing && this.upsertOptions.ignoreDuplicates) continue
          if (existing) Object.assign(existing, row)
          else rows.push({ id: this.db.id(this.table), ...row })
        }
        return { data: null, error: null }
      }
      case 'delete': {
        for (const row of match) rows.splice(rows.indexOf(row), 1)
        return { data: null, error: null }
      }
    }
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const MEETING_ID = '11111111-1111-4111-8111-111111111111'
const SONIOX_KEY = 'sx-test-key-never-real'
const FORMAT = { sampleRate: 16_000, channels: 1, bitsPerSample: 16 }

function wav(bytes: number) {
  const header = buildWavHeader(FORMAT, bytes)
  const out = new Uint8Array(header.length + bytes)
  out.set(header)
  return out
}

function sttColumns(overrides: Row = {}): Row {
  return {
    stt_provider: null,
    stt_state: null,
    stt_model: null,
    stt_job_id: null,
    stt_file_id: null,
    stt_audio_hash: null,
    stt_audio_ms: null,
    stt_usage_event_id: null,
    stt_fallback: false,
    stt_error: null,
    stt_started_at: null,
    stt_upload_claimed_at: null,
    stt_submitted_at: null,
    stt_checked_at: null,
    stt_completed_at: null,
    stt_webhook_token_hash: null,
    stt_webhook_status: null,
    stt_webhook_at: null,
    stt_window: 0,
    stt_window_count: null,
    analysis_progress: null,
    ...overrides,
  }
}

const PART_BYTES = 16_000

function seed(
  db: FakeDb,
  options: { meeting?: Row; legacy?: boolean; segmentStatus?: string[]; durations?: number[] } = {},
) {
  const durations = options.durations ?? (options.segmentStatus ?? ['uploaded', 'uploaded']).map(() => 90_000)
  const statuses = options.segmentStatus ?? durations.map(() => 'uploaded')
  db.rows('meetings').push({
    id: MEETING_ID,
    user_id: 'user-1',
    title: 'Weekly sync',
    status: 'processing',
    project_id: null,
    held_at: null,
    started_at: null,
    language: null,
    summary: null,
    expected_segments: durations.length,
    processing_attempts: 0,
    processing_stage: null,
    processing_error: null,
    analysis_input_hash: null,
    updated_at: new Date(Date.now() - 600_000).toISOString(),
    ...(options.legacy ? {} : sttColumns()),
    ...options.meeting,
  })
  if (options.legacy) db.legacyTables.add('meetings')
  let offset = 0
  durations.forEach((duration, idx) => {
    const path = `user-1/${MEETING_ID}/${idx}.wav`
    db.storage.set(path, wav(PART_BYTES))
    db.rows('meeting_audio_segments').push({
      id: `seg-${idx}`,
      meeting_id: MEETING_ID,
      user_id: 'user-1',
      idx,
      storage_path: path,
      duration_ms: duration,
      offset_ms: offset,
      byte_size: PART_BYTES + 44,
      status: statuses[idx] ?? 'uploaded',
      attempts: 0,
      updated_at: new Date(Date.now() - 600_000).toISOString(),
    })
    offset += duration
  })
}

function meetingRow(db: FakeDb) {
  return db.rows('meetings')[0]!
}

const ok = <T>(data: T) => Promise.resolve({ ok: true as const, data })
const fail = (code: SonioxFailure['code'], retryable: boolean, status: number | null): Promise<SonioxFailure> =>
  Promise.resolve({ ok: false, code, retryable, status, message: `${code} failure` })

function sonioxMock() {
  return {
    uploadFile: vi.fn<SonioxClient['uploadFile']>(() => ok({ id: 'file-1' })),
    createTranscription: vi.fn<SonioxClient['createTranscription']>(() => ok({ id: 'job-1', status: 'queued' as const })),
    getTranscription: vi.fn<SonioxClient['getTranscription']>(() =>
      ok({
        id: 'job-1',
        status: 'completed' as const,
        audio_duration_ms: 180_000,
        client_reference_id: sonioxReference('personal', MEETING_ID),
      }),
    ),
    getTranscript: vi.fn<SonioxClient['getTranscript']>(() =>
      ok({
        text: 'Hello team مرحبا',
        tokens: [
          { text: 'Hello', start_ms: 1_000, end_ms: 1_300, speaker: '1', language: 'en' },
          { text: ' team', start_ms: 1_400, end_ms: 1_700, speaker: '1', language: 'en' },
          { text: 'مرحبا', start_ms: 95_000, end_ms: 95_400, speaker: '2', language: 'ar' },
        ],
      }),
    ),
    deleteTranscription: vi.fn<SonioxClient['deleteTranscription']>(() => ok(undefined)),
    deleteFile: vi.fn<SonioxClient['deleteFile']>(() => ok(undefined)),
  }
}

function setup(options: Parameters<typeof seed>[1] & { sonioxKey?: string | null } = {}) {
  const db = new FakeDb()
  seed(db, options)
  const ctx: EngineContext = {
    client: db.client(),
    os: 'personal',
    apiKey: 'openrouter-test',
    sonioxKey: options.sonioxKey === undefined ? SONIOX_KEY : options.sonioxKey,
    origin: 'https://hilm.test',
    authToken: 'user-jwt',
  }
  const soniox = sonioxMock()
  const routes: Array<string | undefined> = []
  const transcribe = vi.fn(async (c: EngineContext, _meeting: unknown, idx: number): Promise<StepResult> => {
    routes.push(c.sttRoute)
    const segment = db.rows('meeting_audio_segments').find((row) => row.idx === idx)!
    segment.status = 'transcribed'
    return { ok: true, state: 'transcribed', more: true }
  })
  const analyze = vi.fn(async (): Promise<StepResult> => {
    meetingRow(db).status = 'ready'
    return { ok: true, state: 'analyzed', more: false }
  })
  const dispatchSubmission = vi.fn(async () => 'accepted' as const)
  const sleep = vi.fn(async () => undefined)
  const deps = { soniox, transcribe, analyze, dispatchSubmission, sleep }
  const advance = async () => {
    const meeting = await loadMeeting(ctx, MEETING_ID)
    return advanceMeeting(ctx, meeting!, deps)
  }
  const background = async () => submitSonioxJob(ctx, (await loadMeeting(ctx, MEETING_ID))!, { soniox, sleep })
  return { db, ctx, soniox, transcribe, analyze, dispatchSubmission, advance, background, routes }
}

/** Drive the Gemini fallback loop until analysis or an error. */
async function drain(advance: () => Promise<StepResult>, max = 12) {
  const results: StepResult[] = []
  for (let i = 0; i < max; i += 1) {
    const result = await advance()
    results.push(result)
    if (!result.ok || (result.ok && result.state === 'analyzed')) break
  }
  return results
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ── Soniox primary ──────────────────────────────────────────────────────────

describe('Soniox primary transcription', () => {
  it('transcribes the whole meeting once, persists speakers/lines, bills Soniox and analyzes once', async () => {
    const t = setup()

    expect(await t.advance()).toEqual({ ok: true, state: 'busy', more: true })
    expect(meetingRow(t.db)).toMatchObject({ stt_state: 'soniox_processing', stt_provider: 'soniox', processing_stage: 'transcribing' })
    const begins = t.db.calls('begin_ai_request')
    expect(begins).toHaveLength(1)
    expect(begins[0]).toMatchObject({ p_request_kind: 'meeting_transcribe', p_model: 'soniox/stt-async-v5' })
    expect(t.db.calls('tag_ai_usage_event')[0]).toMatchObject({ p_provider: 'soniox', p_stt_route: 'soniox_primary' })
    expect(t.dispatchSubmission).toHaveBeenCalledTimes(1)

    expect(await t.background()).toBe('submitted')
    // One full-meeting upload: header + both parts' PCM, never 90-second jobs.
    expect(t.soniox.uploadFile).toHaveBeenCalledTimes(1)
    const [file] = t.soniox.uploadFile.mock.calls[0] as unknown as [Blob]
    expect(file.size).toBe(44 + 2 * 16_000)
    expect(t.soniox.createTranscription).toHaveBeenCalledTimes(1)
    const input = (t.soniox.createTranscription.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(input).toMatchObject({
      fileId: 'file-1',
      languageHints: ['ar', 'en'],
      clientReferenceId: sonioxReference('personal', MEETING_ID),
      webhookAuthHeaderName: 'X-Hilm-Webhook-Token',
    })
    expect(String(input.webhookUrl)).toBe(`https://hilm.test/api/meeting-stt-webhook?os=personal&meeting=${MEETING_ID}`)
    const row = meetingRow(t.db)
    expect(row.stt_job_id).toBe('job-1')
    // Only the hash of the webhook secret is stored.
    expect(row.stt_webhook_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.stt_webhook_token_hash).not.toBe(input.webhookAuthHeaderValue)

    expect(await t.advance()).toEqual({ ok: true, state: 'transcribed', more: true })
    expect(meetingRow(t.db)).toMatchObject({ stt_state: 'completed', stt_provider: 'soniox', stt_fallback: false })
    const lines = t.db.rows('meeting_transcript_segments')
    expect(lines.map((line) => line.text)).toEqual(['Hello team', 'مرحبا'])
    expect(lines[1]).toMatchObject({ audio_segment_id: 'seg-1', start_ms: 95_000, language: 'ar' })
    const speakers = t.db.rows('meeting_speakers')
    expect(speakers.map((speaker) => speaker.label)).toEqual(['Speaker 1', 'Speaker 2'])
    expect(lines[0]?.speaker_id).toBe(speakers[0]?.id)
    expect(t.db.rows('meeting_audio_segments').every((segment) => segment.status === 'transcribed')).toBe(true)

    const completes = t.db.calls('complete_ai_request')
    expect(completes).toHaveLength(1)
    expect(completes[0]).toMatchObject({ p_status: 'completed', p_model: 'soniox/stt-async-v5', p_audio_ms: 180_000 })
    expect(Number(completes[0]?.p_cost_usd)).toBeGreaterThan(0)
    expect(Number(completes[0]?.p_cost_usd)).toBeLessThan(0.02)
    expect(t.soniox.deleteTranscription).toHaveBeenCalledWith('job-1')
    expect(t.soniox.deleteFile).toHaveBeenCalledWith('file-1')

    expect(await t.advance()).toEqual({ ok: true, state: 'analyzed', more: false })
    expect(t.analyze).toHaveBeenCalledTimes(1)
    expect(t.transcribe).not.toHaveBeenCalled()
    expect(t.db.calls('begin_ai_request')).toHaveLength(1)
  })

  it('never transcribes while the meeting is still recording', async () => {
    const t = setup({ meeting: { status: 'recording', expected_segments: null } })
    expect(await t.advance()).toEqual({ ok: true, state: 'waiting', more: false })
    expect(t.db.calls('begin_ai_request')).toHaveLength(0)
    expect(t.transcribe).not.toHaveBeenCalled()
  })

  it('waits for every part before submitting', async () => {
    const t = setup({ meeting: { expected_segments: 3 } })
    expect(await t.advance()).toEqual({ ok: true, state: 'waiting', more: false })
    expect(t.db.calls('begin_ai_request')).toHaveLength(0)
  })

  it('does not fall back merely because Soniox is slow', async () => {
    const t = setup({
      meeting: sttColumns({
        stt_state: 'soniox_processing',
        stt_job_id: 'job-1',
        stt_usage_event_id: 'evt-9',
        stt_audio_ms: 180_000,
        stt_started_at: new Date(Date.now() - 20 * 60_000).toISOString(),
        stt_submitted_at: new Date(Date.now() - 20 * 60_000).toISOString(),
      }),
    })
    t.soniox.getTranscription.mockImplementation(() =>
      ok({ id: 'job-1', status: 'processing', client_reference_id: sonioxReference('personal', MEETING_ID) }),
    )
    expect(await t.advance()).toEqual({ ok: true, state: 'busy', more: true })
    expect(meetingRow(t.db).stt_state).toBe('soniox_processing')
    expect(meetingRow(t.db).stt_checked_at).toBeTruthy()
    // Throttled: an immediate second advance does not call Soniox again.
    await t.advance()
    expect(t.soniox.getTranscription).toHaveBeenCalledTimes(1)
    expect(t.transcribe).not.toHaveBeenCalled()
  })

  it('re-checks immediately when the webhook reported completion', async () => {
    const t = setup({
      meeting: sttColumns({
        stt_state: 'soniox_processing',
        stt_job_id: 'job-1',
        stt_usage_event_id: 'evt-9',
        stt_started_at: new Date().toISOString(),
        stt_checked_at: new Date().toISOString(),
        stt_webhook_status: 'completed',
      }),
    })
    expect(await t.advance()).toEqual({ ok: true, state: 'transcribed', more: true })
    expect(t.soniox.getTranscription).toHaveBeenCalledTimes(1)
  })
})

// ── Idempotency / duplicates ────────────────────────────────────────────────

describe('duplicate protection', () => {
  it('uploads once even if the background worker runs twice', async () => {
    const t = setup()
    await t.advance()
    expect(await t.background()).toBe('submitted')
    expect(await t.background()).toBe('skipped')
    expect(t.soniox.uploadFile).toHaveBeenCalledTimes(1)
    expect(t.soniox.createTranscription).toHaveBeenCalledTimes(1)
  })

  it('a concurrent worker holding the ledger lock does not start a second Soniox job', async () => {
    const t = setup()
    t.db.rpcHandlers.begin_ai_request = () => ({ ok: false, code: 'in_flight', message: 'busy' })
    expect(await t.advance()).toEqual({ ok: true, state: 'busy', more: true })
    expect(meetingRow(t.db).stt_state).toBeNull()
    expect(t.dispatchSubmission).not.toHaveBeenCalled()
  })

  it('a duplicate completion (webhook + poll) saves the transcript and bills exactly once', async () => {
    const t = setup()
    await t.advance()
    await t.background()
    await t.advance()
    meetingRow(t.db).stt_webhook_status = 'completed'
    await t.advance()
    await t.advance()
    expect(t.db.inserts.filter((insert) => insert.table === 'meeting_transcript_segments')).toHaveLength(1)
    expect(t.db.calls('complete_ai_request')).toHaveLength(1)
    expect(t.soniox.getTranscript).toHaveBeenCalledTimes(1)
    expect(t.analyze).toHaveBeenCalledTimes(1)
  })

  it('an already-billed Soniox key never opens a second bill without the orphan guard', async () => {
    const t = setup()
    t.db.rpcHandlers.begin_ai_request = () => ({ ok: false, code: 'duplicate', status: 'completed' })
    const results = await drain(t.advance)
    expect(meetingRow(t.db)).toMatchObject({ stt_fallback: true, stt_error: 'duplicate_billing_guard' })
    expect(t.dispatchSubmission).not.toHaveBeenCalled()
    expect(results.at(-1)).toEqual({ ok: true, state: 'analyzed', more: false })
  })
})

// ── Automatic Gemini fallback ───────────────────────────────────────────────

describe('automatic Gemini fallback', () => {
  async function expectFallback(t: ReturnType<typeof setup>, reason: string | RegExp) {
    const results = await drain(t.advance)
    const row = meetingRow(t.db)
    expect(row.stt_fallback).toBe(true)
    expect(row.stt_provider).toBe('gemini')
    expect(row.stt_state).toBe('completed')
    expect(String(row.stt_error)).toMatch(reason)
    expect(t.transcribe).toHaveBeenCalledTimes(2)
    expect(t.routes.every((route) => route === 'gemini_fallback')).toBe(true)
    expect(t.analyze).toHaveBeenCalledTimes(1)
    expect(results.every((result) => result.ok)).toBe(true)
    return row
  }

  it('falls back when the background dispatch is rejected', async () => {
    const t = setup()
    t.dispatchSubmission.mockResolvedValue('rejected' as never)
    await expectFallback(t, 'dispatch_failed')
    const failed = t.db.calls('complete_ai_request').find((call) => call.p_status === 'failed')
    expect(failed).toMatchObject({ p_model: 'soniox/stt-async-v5', p_error_code: 'dispatch_failed', p_cost_usd: null })
  })

  it('falls back on an auth failure during upload', async () => {
    const t = setup()
    t.soniox.uploadFile.mockImplementation(() => fail('unauthenticated', false, 401))
    await t.advance()
    expect(await t.background()).toBe('failed')
    expect(meetingRow(t.db).stt_state).toBe('soniox_failed')
    await expectFallback(t, 'upload_unauthenticated')
  })

  it('falls back when job creation fails and frees the uploaded file', async () => {
    const t = setup()
    t.soniox.createTranscription.mockImplementation(() => fail('balance_exhausted', false, 402))
    await t.advance()
    await t.background()
    expect(t.soniox.deleteFile).toHaveBeenCalledWith('file-1')
    await expectFallback(t, 'create_balance_exhausted')
  })

  it('does not retry an ambiguous (network) create, avoiding duplicate jobs', async () => {
    const t = setup()
    t.soniox.createTranscription.mockImplementation(() => fail('network', true, null))
    await t.advance()
    await t.background()
    expect(t.soniox.createTranscription).toHaveBeenCalledTimes(1)
    await expectFallback(t, 'create_network')
  })

  it('falls back when Soniox reports a permanent job error', async () => {
    const t = setup()
    t.soniox.getTranscription.mockImplementation(() =>
      ok({ id: 'job-1', status: 'error', error_type: 'audio_decode_error', client_reference_id: sonioxReference('personal', MEETING_ID) }),
    )
    await t.advance()
    await t.background()
    await expectFallback(t, 'soniox_audio_decode_error')
    expect(t.soniox.deleteTranscription).toHaveBeenCalledWith('job-1')
  })

  it('falls back when the job is no longer retrievable', async () => {
    const t = setup()
    t.soniox.getTranscription.mockImplementation(() => fail('not_found', false, 404))
    await t.advance()
    await t.background()
    await expectFallback(t, 'soniox_not_found')
  })

  it('falls back on a structurally invalid result and records the billed Soniox cost', async () => {
    const t = setup()
    t.soniox.getTranscript.mockImplementation(() => ok({ text: '', tokens: [] }))
    await t.advance()
    await t.background()
    await expectFallback(t, 'empty_transcript')
    const failed = t.db.calls('complete_ai_request').find((call) => call.p_status === 'failed')
    expect(failed).toMatchObject({ p_model: 'soniox/stt-async-v5', p_error_code: 'empty_transcript' })
    expect(Number(failed?.p_cost_usd)).toBeGreaterThan(0)
  })

  it('falls back when the job does not belong to this meeting', async () => {
    const t = setup()
    t.soniox.getTranscription.mockImplementation(() =>
      ok({ id: 'job-1', status: 'completed', client_reference_id: 'hilm:personal:someone-else' }),
    )
    await t.advance()
    await t.background()
    await expectFallback(t, 'reference_mismatch')
    expect(t.soniox.getTranscript).not.toHaveBeenCalled()
  })

  it('falls back after the generous processing deadline, not before', async () => {
    const t = setup({
      meeting: sttColumns({
        stt_state: 'soniox_processing',
        stt_job_id: 'job-1',
        stt_file_id: 'file-1',
        stt_usage_event_id: 'evt-9',
        stt_audio_ms: 180_000,
        stt_started_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        stt_submitted_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      }),
    })
    t.soniox.getTranscription.mockImplementation(() => fail('provider_error', true, 503))
    await expectFallback(t, 'processing_timeout')
  })

  it('falls back when the background submission never started', async () => {
    const t = setup({
      meeting: sttColumns({
        stt_state: 'soniox_processing',
        stt_usage_event_id: 'evt-9',
        stt_started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      }),
    })
    await expectFallback(t, 'dispatch_timeout')
  })

  it('falls back when the webhook reports an error', async () => {
    const t = setup()
    await t.advance()
    await t.background()
    meetingRow(t.db).stt_webhook_status = 'error'
    meetingRow(t.db).stt_checked_at = new Date().toISOString()
    t.soniox.getTranscription.mockImplementation(() =>
      ok({ id: 'job-1', status: 'error', error_type: 'internal_error', client_reference_id: sonioxReference('personal', MEETING_ID) }),
    )
    await expectFallback(t, 'soniox_internal_error')
  })

  it('marks the meeting failed only when the Gemini fallback also fails', async () => {
    const t = setup()
    t.dispatchSubmission.mockResolvedValue('rejected' as never)
    t.transcribe.mockImplementation(async () => {
      meetingRow(t.db).status = 'failed'
      return { ok: false, code: 'segment_failed', message: 'failed', status: 409 }
    })
    await drain(t.advance)
    expect(meetingRow(t.db).stt_state).toBe('gemini_processing')
    expect(t.analyze).not.toHaveBeenCalled()
  })
})

// ── Routing / compatibility ─────────────────────────────────────────────────

describe('routing and historical compatibility', () => {
  it('uses Gemini directly when no Soniox key is configured', async () => {
    const t = setup({ sonioxKey: null })
    await drain(t.advance)
    expect(t.db.calls('begin_ai_request')).toHaveLength(0)
    expect(t.routes).toEqual(['gemini_primary', 'gemini_primary'])
    expect(meetingRow(t.db)).toMatchObject({ stt_state: 'completed', stt_provider: 'gemini', stt_fallback: false })
  })

  it('MEETING_STT_PRIMARY=gemini is an emergency switch to Gemini', () => {
    vi.stubEnv('SONIOX_API_KEY', SONIOX_KEY)
    expect(resolveSonioxKey()).toBe(SONIOX_KEY)
    vi.stubEnv('MEETING_STT_PRIMARY', 'gemini')
    expect(resolveSonioxKey()).toBeNull()
  })

  it('keeps meetings already transcribing per part on the Gemini path', async () => {
    const t = setup({ segmentStatus: ['transcribed', 'uploaded'] })
    await drain(t.advance)
    expect(t.db.calls('begin_ai_request')).toHaveLength(0)
    expect(t.transcribe).toHaveBeenCalledTimes(1)
  })

  it('reads and processes meetings on a database without the stt columns', async () => {
    const t = setup({ legacy: true })
    const meeting = await loadMeeting(t.ctx, MEETING_ID)
    expect(meeting?.title).toBe('Weekly sync')
    await drain(t.advance)
    expect(t.transcribe).toHaveBeenCalledTimes(2)
    expect(t.analyze).toHaveBeenCalledTimes(1)
    expect(t.db.calls('begin_ai_request')).toHaveLength(0)
  })

  it('leaves a historical completed meeting untouched', async () => {
    const t = setup({ meeting: { status: 'ready' }, segmentStatus: ['transcribed', 'transcribed'] })
    expect(await t.advance()).toEqual({ ok: true, state: 'idle', more: false })
    expect(meetingRow(t.db).stt_state).toBeNull()
  })

  it('surfaces spend/quota limits without calling Soniox', async () => {
    const t = setup()
    t.db.rpcHandlers.begin_ai_request = () => ({ ok: false, code: 'daily_cost_limit', message: 'limit' })
    expect(await t.advance()).toMatchObject({ ok: false, code: 'daily_cost_limit', status: 429 })
    expect(meetingRow(t.db)).toMatchObject({ processing_stage: 'waiting_quota', stt_state: null })
    expect(t.dispatchSubmission).not.toHaveBeenCalled()
  })

  it('a manual retry after both providers failed gives Soniox a fresh attempt', async () => {
    const t = setup({
      meeting: { status: 'failed', ...sttColumns({ stt_state: 'failed', stt_fallback: true, stt_job_id: 'old', stt_provider: 'gemini' }) },
      segmentStatus: ['transcribed', 'failed'],
    })
    const meeting = (await loadMeeting(t.ctx, MEETING_ID))!
    expect(await retryMeeting(t.ctx, meeting, 3)).toMatchObject({ ok: true })
    expect(meetingRow(t.db)).toMatchObject({ status: 'processing', stt_state: 'pending', stt_job_id: null, stt_fallback: false })
  })

  it('a manual retry never resets a running Soniox job', async () => {
    const t = setup({ meeting: { status: 'failed', ...sttColumns({ stt_state: 'soniox_processing', stt_job_id: 'job-1' }) } })
    await retryMeeting(t.ctx, (await loadMeeting(t.ctx, MEETING_ID))!, 3)
    expect(meetingRow(t.db)).toMatchObject({ stt_state: 'soniox_processing', stt_job_id: 'job-1' })
  })
})

// ── Security ────────────────────────────────────────────────────────────────

describe('security', () => {
  it('never logs or stores the Soniox key, and stores no audio in the database', async () => {
    const t = setup()
    t.soniox.uploadFile.mockImplementation(() => fail('unauthenticated', false, 401))
    await t.advance()
    await t.background()
    await drain(t.advance)
    const logged = JSON.stringify([
      ...(console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls,
      ...(console.error as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ])
    expect(logged).not.toContain(SONIOX_KEY)
    const stored = JSON.stringify([...t.db.tables.values()])
    expect(stored).not.toContain(SONIOX_KEY)
    expect(stored).not.toMatch(/RIFF|base64/)
  })

  it('hands off to the background function with the user JWT only, never the Soniox key', async () => {
    const t = setup()
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const meeting = (await loadMeeting(t.ctx, MEETING_ID))!
      await advanceMeeting(t.ctx, meeting, { soniox: t.soniox, transcribe: t.transcribe, analyze: t.analyze })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://hilm.test/.netlify/functions/meeting-stt-background')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-jwt')
    expect(JSON.parse(String(init.body))).toEqual({ os: 'personal', meetingId: MEETING_ID })
    expect(JSON.stringify(init)).not.toContain(SONIOX_KEY)
  })
})

// ── Long meetings (the reported one-hour cutoff) ────────────────────────────

const MIN = 60_000
const tokenAt = (text: string, start: number, speaker: string, language = 'en'): SonioxToken => ({
  text,
  start_ms: start,
  end_ms: start + 300,
  speaker,
  language,
})

/** Recorder-style parts (~90 s) covering `totalMs`. */
function durationsFor(totalMs: number, partMs = 90_000) {
  const out: number[] = []
  for (let offset = 0; offset < totalMs; offset += partMs) out.push(Math.min(partMs, totalMs - offset))
  return out
}

/** Soniox mock that tells jobs apart by the client reference Hilm sent (one job per window). */
function windowedSoniox(t: ReturnType<typeof setup>, tokensFor: (window: number) => SonioxToken[]) {
  const refs = new Map<string, string>()
  let jobs = 0
  t.soniox.createTranscription.mockImplementation(async (input) => {
    jobs += 1
    const id = `job-${jobs}`
    refs.set(id, input.clientReferenceId)
    return { ok: true, data: { id, status: 'queued' as const } }
  })
  const windowOf = (id: string) => Number(/:w(\d+)$/.exec(refs.get(id) ?? '')?.[1] ?? 0)
  // Soniox reports the real audio length (the fake WAV files hold only a little PCM each).
  const windows = planSonioxWindows(t.db.rows('meeting_audio_segments') as unknown as SonioxAudioPart[])
  t.soniox.getTranscription.mockImplementation(async (id) => ({
    ok: true,
    data: {
      id,
      status: 'completed' as const,
      client_reference_id: refs.get(id) ?? null,
      audio_duration_ms: windows[windowOf(id)]?.audioMs ?? null,
    },
  }))
  t.soniox.getTranscript.mockImplementation(async (id) => {
    const window = windowOf(id)
    const tokens = tokensFor(window)
    return { ok: true, data: { text: tokens.map((token) => token.text).join(''), tokens } }
  })
  return refs
}

/** Drives the client loop + background worker until analysis (or an error). */
async function runToAnalysis(t: ReturnType<typeof setup>, max = 60) {
  for (let i = 0; i < max; i += 1) {
    const row = meetingRow(t.db)
    if (row.stt_state === 'soniox_processing' && !row.stt_job_id) await t.background()
    const result = await t.advance()
    if (!result.ok || result.state === 'analyzed') return result
  }
  throw new Error('meeting did not finish')
}

function savedLines(t: ReturnType<typeof setup>) {
  const labels = new Map(t.db.rows('meeting_speakers').map((row) => [row.id, row.label]))
  return [...t.db.rows('meeting_transcript_segments')]
    .sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
    .map((row) => ({
      text: String(row.text),
      start: Number(row.start_ms),
      part: String(row.audio_segment_id),
      speaker: labels.get(row.speaker_id),
    }))
}

describe('long meetings', () => {
  it.each([
    ['59 minutes', 59 * MIN],
    ['75 minutes', 75 * MIN],
    ['the reported 1:15:57 meeting', 75 * MIN + 57_000],
  ])('transcribes all of %s in one job and analyses it once', async (_label, totalMs) => {
    const durations = durationsFor(totalMs)
    const t = setup({ durations })
    windowedSoniox(t, () => [
      tokenAt('Opening remarks', 2_000, '1'),
      tokenAt('منتصف الاجتماع', Math.round(totalMs / 2), '2', 'ar'),
      tokenAt('Final words before we close', totalMs - 3_000, '1'),
    ])
    expect(await runToAnalysis(t)).toEqual({ ok: true, state: 'analyzed', more: false })
    const lines = savedLines(t)
    expect(lines.map((line) => line.text)).toEqual(['Opening remarks', 'منتصف الاجتماع', 'Final words before we close'])
    // The last minute of the recording is stored against the last recorded part.
    expect(lines.at(-1)).toMatchObject({ start: totalMs - 3_000, part: `seg-${durations.length - 1}` })
    expect(t.soniox.uploadFile).toHaveBeenCalledTimes(1)
    expect(t.db.rows('meeting_audio_segments').every((part) => part.status === 'transcribed')).toBe(true)
    expect(t.analyze).toHaveBeenCalledTimes(1)
    expect(t.transcribe).not.toHaveBeenCalled()
  })

  describe('200-minute meeting (two Soniox windows)', () => {
    const totalMs = 200 * MIN
    const sharedStart = 79 * 90_000
    const boundary = sharedStart + 45_000
    const overlap = (speaker: string, base: number) =>
      Array.from({ length: 10 }, (_, i) => tokenAt(` w${i}`, boundary - 40_000 + i * 3_000 - base, speaker))
    const tokensFor = (window: number) =>
      window === 0
        ? [
            tokenAt('Opening', 1_000, '1'),
            tokenAt('Middle مرحبا', 100 * MIN, '2', 'ar'),
            ...overlap('1', 0),
            tokenAt(' bridge', boundary + 1_000, '1'),
          ]
        : [...overlap('2', sharedStart), tokenAt(' bridge', boundary + 1_000 - sharedStart, '2'), tokenAt('Closing', totalMs - 5_000 - sharedStart, '1')]

    it('runs the windows in order, keeps every word once and analyses only after the last window', async () => {
      const t = setup({ durations: durationsFor(totalMs) })
      windowedSoniox(t, tokensFor)

      await t.advance()
      await t.background()
      expect(await t.advance()).toEqual({ ok: true, state: 'busy', more: true })
      // First window saved; the meeting is not done and analysis has not started.
      expect(meetingRow(t.db)).toMatchObject({ stt_state: 'pending', stt_window: 1, stt_window_count: 2 })
      expect(t.analyze).not.toHaveBeenCalled()

      expect(await runToAnalysis(t)).toEqual({ ok: true, state: 'analyzed', more: false })
      const lines = savedLines(t)
      expect(lines.map((line) => [line.text, line.speaker])).toEqual([
        ['Opening', 'Speaker 1'],
        ['Middle مرحبا', 'Speaker 2'],
        ['w0 w1 w2 w3 w4 w5 w6 w7 w8 w9', 'Speaker 1'],
        // Same voice across the boundary (overlap evidence) keeps its label…
        ['bridge', 'Speaker 1'],
        // …while the second job's "1" is a new person, not the first job's Speaker 1.
        ['Closing', 'Speaker 3'],
      ])
      expect(lines.map((line) => line.start)).toEqual([...lines.map((line) => line.start)].sort((a, b) => a - b))
      expect(lines.at(-1)!.start).toBe(totalMs - 5_000)

      // Two Soniox jobs, each uploading only its own parts; two bills, both completed.
      const sizes = t.soniox.uploadFile.mock.calls.map(([file]) => (file as Blob).size)
      expect(sizes).toEqual([44 + 80 * PART_BYTES, 44 + 55 * PART_BYTES])
      const begins = t.db.calls('begin_ai_request').filter((call) => call.p_model === 'soniox/stt-async-v5')
      expect(begins).toHaveLength(2)
      expect(String(begins[1]!.p_idempotency_key)).toContain(':soniox:w1:')
      expect(t.db.calls('complete_ai_request').filter((call) => call.p_status === 'completed')).toHaveLength(2)
      expect(meetingRow(t.db)).toMatchObject({ stt_state: 'completed', stt_provider: 'soniox', stt_fallback: false })
      expect(t.analyze).toHaveBeenCalledTimes(1)
    })

    it('re-saving a window (killed worker, duplicate completion) never duplicates lines', async () => {
      const t = setup({ durations: durationsFor(totalMs) })
      windowedSoniox(t, tokensFor)
      await runToAnalysis(t)
      const before = savedLines(t)
      Object.assign(meetingRow(t.db), {
        status: 'processing',
        stt_state: 'soniox_completed',
        stt_checked_at: new Date(Date.now() - 10 * MIN).toISOString(),
      })
      await t.advance()
      expect(savedLines(t)).toEqual(before)
    })

    it('falls back to Gemini for the whole meeting if a later window fails, without mixing providers', async () => {
      const t = setup({ durations: durationsFor(totalMs) })
      windowedSoniox(t, tokensFor)
      const create = t.soniox.createTranscription.getMockImplementation()!
      t.soniox.createTranscription.mockImplementation(async (input) =>
        input.clientReferenceId.endsWith(':w1') ? fail('balance_exhausted', false, 402) : create(input),
      )
      expect(await runToAnalysis(t, 400)).toEqual({ ok: true, state: 'analyzed', more: false })
      expect(meetingRow(t.db)).toMatchObject({ stt_fallback: true, stt_error: 'create_balance_exhausted', stt_provider: 'gemini' })
      // Window 1 of Soniox was discarded; every part went through the Gemini path.
      expect(t.db.rows('meeting_transcript_segments')).toHaveLength(0)
      expect(t.transcribe).toHaveBeenCalledTimes(134)
      expect(t.routes.every((route) => route === 'gemini_fallback')).toBe(true)
      expect(t.analyze).toHaveBeenCalledTimes(1)
    })
  })

  it('a dropped connection to Soniox is retried later instead of failing the meeting', async () => {
    const t = setup({ durations: durationsFor(75 * MIN) })
    windowedSoniox(t, () => [tokenAt('Hello', 1_000, '1')])
    const completed = t.soniox.getTranscription.getMockImplementation()!
    t.soniox.getTranscription.mockImplementationOnce(() => fail('network', true, null))
    await t.advance()
    await t.background()
    expect(await t.advance()).toEqual({ ok: true, state: 'busy', more: true })
    expect(meetingRow(t.db).stt_state).toBe('soniox_processing')
    t.soniox.getTranscription.mockImplementation(completed)
    meetingRow(t.db).stt_checked_at = new Date(Date.now() - MIN).toISOString()
    expect(await runToAnalysis(t)).toEqual({ ok: true, state: 'analyzed', more: false })
    expect(meetingRow(t.db).stt_fallback).toBe(false)
  })

  it('never starts transcription or analysis while recorded parts are still uploading', async () => {
    const durations = durationsFor(75 * MIN + 57_000)
    const t = setup({ durations, meeting: { expected_segments: durations.length + 1 } })
    for (let i = 0; i < 3; i += 1) expect(await t.advance()).toEqual({ ok: true, state: 'waiting', more: false })
    expect(t.db.calls('begin_ai_request')).toHaveLength(0)
    expect(t.analyze).not.toHaveBeenCalled()
  })
})

// ── Resumable analysis of long transcripts ──────────────────────────────────

describe('resumable analysis', () => {
  function analysisSetup() {
    const t = setup({
      segmentStatus: ['transcribed', 'transcribed'],
      meeting: sttColumns({ stt_state: 'completed', stt_provider: 'soniox' }),
    })
    t.db.rows('meeting_speakers').push({ id: 'spk-1', meeting_id: MEETING_ID, label: 'Speaker 1', display_name: null, ordinal: 0 })
    // ~70k characters: beyond one direct call, so the analysis runs in steps.
    for (let i = 0; i < 70; i += 1) {
      t.db.rows('meeting_transcript_segments').push({
        id: `line-${i}`,
        meeting_id: MEETING_ID,
        speaker_id: 'spk-1',
        ordinal: i,
        start_ms: i * MIN,
        text: `${i % 2 ? 'نناقش الخطة' : 'We discuss the plan'} ${i} ${'x'.repeat(980)}`,
      })
    }
    const steps: string[] = []
    const executeStep: typeof executeAnalysisStep = async (input, planned) => {
      steps.push(planned.step.key)
      const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.00001 }
      const partial = { summary: planned.step.key, key_points: [], decisions: [], action_items: [] }
      const progress = planned.progress!
      if (planned.step.kind === 'chunk') {
        progress.levels[0]![planned.step.index] = partial
        return { ok: true, done: false, progress, model: 'test', usage }
      }
      if (planned.step.kind === 'merge') {
        progress.levels[planned.step.level + 1]![planned.step.group] = partial
        return { ok: true, done: false, progress, model: 'test', usage }
      }
      return {
        ok: true,
        done: true,
        model: 'test',
        usage,
        strategy: 'hierarchical',
        analysisInputHash: hashAnalysisInput(input.lines),
        analysis: {
          language: 'en',
          summary: 'Whole meeting',
          key_points: ['start', 'end'],
          decisions: [{ text: 'Ship it', certainty: 'confirmed', source_segment_ids: ['line-0', 'line-69'] }],
          action_items: [
            {
              title: 'Follow up',
              description: null,
              ownerLabel: 'Speaker 1',
              owner_certainty: 'confirmed',
              due_text: null,
              due_date: null,
              priority: 'medium',
              certainty: 'confirmed',
              source_segment_ids: ['line-69'],
            },
          ],
        },
      } as AnalysisStepResult
    }
    const advance = async () =>
      advanceMeeting(t.ctx, (await loadMeeting(t.ctx, MEETING_ID))!, {
        soniox: t.soniox,
        transcribe: t.transcribe,
        analyze: (c, m) => analyzeMeeting(c, m, { executeStep }),
      })
    return { t, steps, advance }
  }

  it('runs one step per request, persists progress, and writes the final analysis exactly once', async () => {
    const { t, steps, advance } = analysisSetup()
    expect(await advance()).toEqual({ ok: true, state: 'busy', more: true })
    expect(meetingRow(t.db)).toMatchObject({ processing_stage: 'analysis_pending', status: 'processing' })
    expect((meetingRow(t.db).analysis_progress as { levels: unknown[][] }).levels[0]![0]).toBeTruthy()

    let result = await advance()
    for (let i = 0; i < 10 && result.ok && result.state !== 'analyzed'; i += 1) result = await advance()
    expect(result).toEqual({ ok: true, state: 'analyzed', more: false })
    expect(steps).toEqual(['c0', 'c1', 'f0'])
    // Each step is billed under its own idempotency key.
    const keys = t.db.calls('begin_ai_request').map((call) => String(call.p_idempotency_key))
    expect(keys.map((key) => key.split(':').at(-1))).toEqual(['c0', 'c1', 'f0'])
    expect(meetingRow(t.db)).toMatchObject({ status: 'ready', summary: 'Whole meeting', analysis_progress: null })
    expect(t.db.rows('meeting_decisions')).toHaveLength(1)
    expect(t.db.rows('meeting_action_items')).toHaveLength(1)

    // Reloads and repeated finalization calls do not duplicate anything.
    for (let i = 0; i < 3; i += 1) expect(await advance()).toEqual({ ok: true, state: 'idle', more: false })
    expect(steps).toEqual(['c0', 'c1', 'f0'])
    expect(t.db.rows('meeting_decisions')).toHaveLength(1)
    expect(t.db.rows('meeting_action_items')).toHaveLength(1)
  })

  it('resumes after a failed step instead of starting over', async () => {
    const { t, steps, advance } = analysisSetup()
    await advance()
    // The second step's ledger entry was billed but its result never saved (worker killed).
    t.db.rpcHandlers.begin_ai_request = (args) =>
      String(args.p_idempotency_key).endsWith(':c1')
        ? { ok: false, code: 'duplicate', status: 'completed' }
        : { ok: true, event_id: `evt-${String(args.p_idempotency_key).slice(-4)}` }
    let result = await advance()
    for (let i = 0; i < 10 && result.ok && result.state !== 'analyzed'; i += 1) result = await advance()
    expect(result).toEqual({ ok: true, state: 'analyzed', more: false })
    expect(steps).toEqual(['c0', 'c1', 'f0'])
    expect(t.db.calls('begin_ai_request').map((call) => String(call.p_idempotency_key).split(':').slice(-2).join(':'))).toContain('c1:orphan')
  })
})
