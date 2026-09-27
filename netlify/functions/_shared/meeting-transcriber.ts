/**
 * Isolated OpenRouter access for meetings. No database or storage access happens here,
 * so the same code path is used by the processing engine and the live accuracy test.
 */
import {
  MEETING_TRANSCRIBE_MODEL,
  extractJsonObject,
  transcriptionResponseSchema,
  type TranscriptionResponse,
} from './meeting-core'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const PROVIDER_TIMEOUT_MS = 21_000

export type OpenRouterResult =
  | { ok: true; content: string; usage: unknown }
  | { ok: false; code: 'provider_error' | 'provider_timeout'; detail: string }

export async function callOpenRouter(
  apiKey: string,
  body: Record<string, unknown>,
  title: string,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<OpenRouterResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || process.env.VITE_APP_URL || 'https://hillm.netlify.app',
        'X-Title': title,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')) || `HTTP ${response.status}`
      return { ok: false, code: 'provider_error', detail }
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: unknown
    }
    return { ok: true, content: payload.choices?.[0]?.message?.content ?? '', usage: payload.usage }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      code: aborted ? 'provider_timeout' : 'provider_error',
      detail: error instanceof Error ? error.message : 'Network error',
    }
  } finally {
    clearTimeout(timer)
  }
}

export type TranscribeChunkResult =
  | { ok: true; data: TranscriptionResponse; content: string; usage: unknown }
  | { ok: false; code: 'provider_error' | 'provider_timeout' | 'parse_error'; detail: string; content?: string; usage?: unknown }

/** Sends one WAV chunk (base64) with the transcription prompt and validates the JSON reply. */
export async function transcribeAudioChunk(input: {
  apiKey: string
  audioBase64: string
  prompt: string
  timeoutMs?: number
}): Promise<TranscribeChunkResult> {
  const result = await callOpenRouter(
    input.apiKey,
    {
      model: MEETING_TRANSCRIBE_MODEL,
      stream: false,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: input.prompt },
            { type: 'input_audio', input_audio: { data: input.audioBase64, format: 'wav' } },
          ],
        },
      ],
    },
    'Hilm Meeting Transcription',
    input.timeoutMs,
  )
  if (!result.ok) return result

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
