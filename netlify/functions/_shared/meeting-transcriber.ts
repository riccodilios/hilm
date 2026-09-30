/**
 * Meeting STT via the central AI gateway.
 * No database or storage access — used by the engine and live accuracy tests.
 */
import {
  MEETING_TRANSCRIBE_MODEL,
  extractJsonObject,
  transcriptionResponseSchema,
  type TranscriptionResponse,
} from './meeting-core'
import { getAiRuntimeConfig } from './ai-config'
import { AI_GATEWAY_TIMEOUT_MS, MEETING_STT_TIMEOUT_MS, runAiCompletion } from './ai-gateway'

export { AI_GATEWAY_TIMEOUT_MS as PROVIDER_TIMEOUT_MS, MEETING_STT_TIMEOUT_MS }

export type OpenRouterResult =
  | { ok: true; content: string; usage: unknown }
  | { ok: false; code: 'provider_error' | 'provider_timeout' | 'disabled' | 'rate_limited' | 'invalid_request'; detail: string }

/** @deprecated Prefer runAiCompletion from ai-gateway for new code. Kept for tests. */
export async function callOpenRouter(
  apiKey: string,
  body: Record<string, unknown>,
  title: string,
  timeoutMs = AI_GATEWAY_TIMEOUT_MS,
): Promise<OpenRouterResult> {
  const messages = (body.messages ?? []) as Parameters<typeof runAiCompletion>[0]['messages']
  const result = await runAiCompletion({
    apiKey,
    feature: 'meeting_analyze',
    model: typeof body.model === 'string' ? body.model : undefined,
    messages,
    maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : 4096,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
    responseFormat: body.response_format as { type: 'json_object' } | undefined,
    timeoutMs,
    title,
    allowRetry: false,
  })
  if (!result.ok) {
    const code =
      result.code === 'disabled' || result.code === 'rate_limited' || result.code === 'invalid_request'
        ? result.code
        : result.code === 'provider_timeout'
          ? 'provider_timeout'
          : 'provider_error'
    return { ok: false, code, detail: result.detail }
  }
  return { ok: true, content: result.content, usage: result.usage }
}

export type TranscribeChunkResult =
  | { ok: true; data: TranscriptionResponse; content: string; usage: unknown }
  | {
      ok: false
      code: 'provider_error' | 'provider_timeout' | 'parse_error' | 'disabled' | 'rate_limited' | 'invalid_request'
      detail: string
      content?: string
      usage?: unknown
    }

/** Sends one WAV chunk (base64) with the transcription prompt and validates the JSON reply. */
export async function transcribeAudioChunk(input: {
  apiKey: string
  audioBase64: string
  prompt: string
  timeoutMs?: number
  model?: string
}): Promise<TranscribeChunkResult> {
  const config = getAiRuntimeConfig()
  const result = await runAiCompletion({
    apiKey: input.apiKey,
    feature: 'meeting_transcription',
    model: input.model || config.models.meeting_transcription || MEETING_TRANSCRIBE_MODEL,
    // STT JSON segments — keep output bounded; audio is the main cost.
    maxTokens: 4096,
    temperature: 0,
    responseFormat: { type: 'json_object' },
    // Single long attempt: in-gateway retries of 21s×2 used to exceed the old 26s Netlify
    // function timeout and surface as opaque HTTP 500s. Segment-level retries handle recovery.
    timeoutMs: input.timeoutMs ?? MEETING_STT_TIMEOUT_MS,
    title: 'Hilm Meeting Transcription',
    allowRetry: false,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: input.prompt },
          { type: 'input_audio', input_audio: { data: input.audioBase64, format: 'wav' } },
        ],
      },
    ],
  })
  if (!result.ok) {
    return { ok: false, code: result.code, detail: result.detail, usage: result.usage }
  }

  const json = extractJsonObject(result.content)
  const parsed = json ? transcriptionResponseSchema.safeParse(json) : null
  if (!parsed?.success) {
    return {
      ok: false,
      code: 'parse_error',
      detail: result.content.slice(0, 300),
      content: result.content,
      usage: result.usage,
    }
  }
  return { ok: true, data: parsed.data, content: result.content, usage: result.usage }
}
