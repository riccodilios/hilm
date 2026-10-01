/** Server-only Soniox async speech-to-text REST client. The API key never leaves this module. */
import { z } from 'zod'

export const SONIOX_API_BASE = 'https://api.soniox.com/v1'
export const SONIOX_ASYNC_MODEL = 'stt-async-v5'

export function sonioxApiKey(): string | null {
  return process.env.SONIOX_API_KEY?.trim() || null
}

export type SonioxFailureCode =
  | 'unauthenticated'
  | 'balance_exhausted'
  | 'rate_limited'
  | 'invalid_request'
  | 'not_found'
  | 'invalid_state'
  | 'provider_error'
  | 'network'
  | 'timeout'
  | 'invalid_response'

export type SonioxFailure = {
  ok: false
  code: SonioxFailureCode
  retryable: boolean
  status: number | null
  message: string
}
export type SonioxResult<T> = { ok: true; data: T } | SonioxFailure

const fileSchema = z.object({ id: z.string().min(1).max(64) })

const transcriptionSchema = z.object({
  id: z.string().min(1).max(64),
  status: z.enum(['queued', 'processing', 'completed', 'error']),
  error_type: z.string().nullish(),
  error_message: z.string().nullish(),
  audio_duration_ms: z.number().nullish(),
  client_reference_id: z.string().nullish(),
})
export type SonioxTranscription = z.infer<typeof transcriptionSchema>

const tokenSchema = z.object({
  text: z.string(),
  start_ms: z.number().nonnegative(),
  end_ms: z.number().nonnegative(),
  confidence: z.number().nullish(),
  speaker: z.union([z.string(), z.number()]).nullish(),
  language: z.string().nullish(),
  translation_status: z.string().nullish(),
})
export type SonioxToken = z.infer<typeof tokenSchema>

const transcriptSchema = z.object({
  id: z.string().nullish(),
  text: z.string(),
  tokens: z.array(tokenSchema),
})
export type SonioxTranscript = z.infer<typeof transcriptSchema>

export type SonioxContext = {
  general?: Array<{ key: string; value: string }>
  terms?: string[]
  text?: string
}

export type CreateTranscriptionInput = {
  fileId: string
  context?: SonioxContext
  languageHints?: string[]
  webhookUrl?: string | null
  webhookAuthHeaderName?: string
  webhookAuthHeaderValue?: string
  clientReferenceId: string
}

export type SonioxClient = ReturnType<typeof createSonioxClient>

function classifyStatus(status: number): { code: SonioxFailureCode; retryable: boolean } {
  if (status === 401 || status === 403) return { code: 'unauthenticated', retryable: false }
  if (status === 402) return { code: 'balance_exhausted', retryable: false }
  if (status === 404) return { code: 'not_found', retryable: false }
  if (status === 409) return { code: 'invalid_state', retryable: false }
  if (status === 429) return { code: 'rate_limited', retryable: true }
  if (status === 408) return { code: 'timeout', retryable: true }
  if (status >= 500) return { code: 'provider_error', retryable: true }
  return { code: 'invalid_request', retryable: false }
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error_type?: unknown; message?: unknown }
    const type = typeof body.error_type === 'string' ? body.error_type : ''
    const message = typeof body.message === 'string' ? body.message : ''
    return `${type}${type && message ? ': ' : ''}${message}`.slice(0, 300) || `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

export function createSonioxClient(options: {
  apiKey: string
  fetchImpl?: typeof fetch
  baseUrl?: string
}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl ?? SONIOX_API_BASE
  const auth = { Authorization: `Bearer ${options.apiKey}` }

  async function call<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T> | null,
    timeoutMs: number,
  ): Promise<SonioxResult<T>> {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...auth, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      return {
        ok: false,
        code: timedOut ? 'timeout' : 'network',
        retryable: true,
        status: null,
        message: timedOut ? 'Soniox request timed out' : 'Soniox request failed',
      }
    }
    if (!response.ok) {
      const { code, retryable } = classifyStatus(response.status)
      return { ok: false, code, retryable, status: response.status, message: await readError(response) }
    }
    if (!schema) return { ok: true, data: undefined as T }
    let json: unknown
    try {
      json = await response.json()
    } catch {
      return { ok: false, code: 'invalid_response', retryable: false, status: response.status, message: 'Invalid JSON' }
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      return {
        ok: false,
        code: 'invalid_response',
        retryable: false,
        status: response.status,
        message: 'Unexpected Soniox response shape',
      }
    }
    return { ok: true, data: parsed.data }
  }

  return {
    uploadFile(file: Blob, filename: string, clientReferenceId: string) {
      const form = new FormData()
      form.append('file', file, filename)
      form.append('client_reference_id', clientReferenceId)
      return call('/files', { method: 'POST', body: form }, fileSchema, 10 * 60_000)
    },
    createTranscription(input: CreateTranscriptionInput) {
      const body: Record<string, unknown> = {
        model: SONIOX_ASYNC_MODEL,
        file_id: input.fileId,
        enable_speaker_diarization: true,
        enable_language_identification: true,
        client_reference_id: input.clientReferenceId,
      }
      if (input.languageHints?.length) body.language_hints = input.languageHints
      if (input.context) body.context = input.context
      if (input.webhookUrl) {
        body.webhook_url = input.webhookUrl
        if (input.webhookAuthHeaderName && input.webhookAuthHeaderValue) {
          body.webhook_auth_header_name = input.webhookAuthHeaderName
          body.webhook_auth_header_value = input.webhookAuthHeaderValue
        }
      }
      return call(
        '/transcriptions',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        transcriptionSchema,
        30_000,
      )
    },
    getTranscription(id: string) {
      return call(`/transcriptions/${encodeURIComponent(id)}`, { method: 'GET' }, transcriptionSchema, 15_000)
    },
    getTranscript(id: string) {
      return call(`/transcriptions/${encodeURIComponent(id)}/transcript`, { method: 'GET' }, transcriptSchema, 45_000)
    },
    deleteTranscription(id: string) {
      return call(`/transcriptions/${encodeURIComponent(id)}`, { method: 'DELETE' }, null, 15_000)
    },
    deleteFile(id: string) {
      return call(`/files/${encodeURIComponent(id)}`, { method: 'DELETE' }, null, 15_000)
    },
  }
}

/** Retries transient Soniox failures (rate limits, 5xx, network) a bounded number of times. */
export async function withSonioxRetry<T>(
  run: () => Promise<SonioxResult<T>>,
  options: {
    delaysMs?: number[]
    sleep?: (ms: number) => Promise<void>
    retryIf?: (failure: SonioxFailure) => boolean
  } = {},
): Promise<SonioxResult<T>> {
  const delays = options.delaysMs ?? [2_000, 6_000]
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let result = await run()
  for (const delay of delays) {
    if (result.ok || !result.retryable) return result
    if (options.retryIf && !options.retryIf(result)) return result
    await sleep(delay)
    result = await run()
  }
  return result
}
