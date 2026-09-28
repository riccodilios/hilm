/**
 * Central server-side AI gateway.
 * All non-streaming OpenRouter completions should go through here so model
 * selection, token caps, retries, and kill switches stay consistent.
 *
 * Streaming chat remains in ai-chat.ts but still uses begin/complete metering
 * and resolveFeatureModel for the model id.
 */
import { createHash } from 'node:crypto'
import {
  featureDisabledMessage,
  getAiRuntimeConfig,
  resolveFeatureModel,
  type AiFeature,
} from './ai-config'
import { tokensFromOpenRouterUsage, type AiUsageTokens } from './ai-guard'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const AI_GATEWAY_TIMEOUT_MS = 21_000

export type GatewayMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | {
      role: 'user'
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'input_audio'; input_audio: { data: string; format: string } }
      >
    }

export type GatewayResult =
  | { ok: true; content: string; usage: unknown; tokens: AiUsageTokens; model: string; attempts: number }
  | {
      ok: false
      code: 'disabled' | 'provider_error' | 'provider_timeout' | 'rate_limited' | 'invalid_request'
      detail: string
      model: string
      attempts: number
      usage?: unknown
      tokens?: AiUsageTokens
    }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryable(code: GatewayResult extends { ok: false } ? GatewayResult['code'] : never, status?: number) {
  if (code === 'provider_timeout') return true
  if (code === 'provider_error' && status != null && status >= 500) return true
  return false
}

export function hashStable(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hashBytes(buffer: ArrayBuffer | Buffer | Uint8Array): string {
  return createHash('sha256').update(Buffer.from(buffer as ArrayBuffer)).digest('hex')
}

/**
 * Non-streaming completion with bounded retries and explicit max_tokens.
 * Does NOT stream. Does NOT bypass begin_ai_request metering — callers still guard.
 */
export async function runAiCompletion(input: {
  apiKey: string
  feature: AiFeature
  messages: GatewayMessage[]
  /** Override routed model (must still be an allowlisted model at the call site if required). */
  model?: string
  maxTokens?: number
  temperature?: number
  responseFormat?: { type: 'json_object' } | null
  timeoutMs?: number
  title?: string
  /** When false, skip retries (e.g. after parse failures should not re-bill blindly). */
  allowRetry?: boolean
}): Promise<GatewayResult> {
  const config = getAiRuntimeConfig()
  const model = input.model?.trim() || resolveFeatureModel(input.feature, config)

  if (!config.aiEnabled) {
    return { ok: false, code: 'disabled', detail: featureDisabledMessage('chat'), model, attempts: 0 }
  }
  if (input.feature === 'meeting_transcription' && !config.transcriptionEnabled) {
    return {
      ok: false,
      code: 'disabled',
      detail: featureDisabledMessage('meeting_transcription'),
      model,
      attempts: 0,
    }
  }
  if (
    (input.feature === 'meeting_analyze' || input.feature === 'meeting_chunk_summary') &&
    !config.analysisEnabled
  ) {
    return {
      ok: false,
      code: 'disabled',
      detail: featureDisabledMessage(input.feature),
      model,
      attempts: 0,
    }
  }

  const maxAttempts =
    input.allowRetry === false ? 1 : Math.max(1, config.retry.maxAttempts)
  const timeoutMs = input.timeoutMs ?? AI_GATEWAY_TIMEOUT_MS
  const title = input.title ?? `Hilm ${input.feature}`

  let lastFailure: Extract<GatewayResult, { ok: false }> | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const body: Record<string, unknown> = {
        model,
        stream: false,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 2048,
        messages: input.messages,
      }
      if (input.responseFormat) body.response_format = input.responseFormat

      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || process.env.VITE_APP_URL || 'https://hillm.netlify.app',
          'X-Title': title,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')) || `HTTP ${response.status}`
        const code =
          response.status === 429
            ? 'rate_limited'
            : response.status === 400 || response.status === 422
              ? 'invalid_request'
              : 'provider_error'
        lastFailure = { ok: false, code, detail, model, attempts: attempt }
        if (code === 'rate_limited' || !isRetryable(code, response.status) || attempt >= maxAttempts) {
          return lastFailure
        }
        await sleep(config.retry.baseDelayMs * 2 ** (attempt - 1))
        continue
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: unknown
      }
      const content = payload.choices?.[0]?.message?.content ?? ''
      const tokens = tokensFromOpenRouterUsage(payload.usage)
      return { ok: true, content, usage: payload.usage, tokens, model, attempts: attempt }
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'
      lastFailure = {
        ok: false,
        code: aborted ? 'provider_timeout' : 'provider_error',
        detail: error instanceof Error ? error.message : 'Network error',
        model,
        attempts: attempt,
      }
      if (!aborted || attempt >= maxAttempts) return lastFailure
      await sleep(config.retry.baseDelayMs * 2 ** (attempt - 1))
    } finally {
      clearTimeout(timer)
    }
  }

  return (
    lastFailure ?? {
      ok: false,
      code: 'provider_error',
      detail: 'Unknown provider failure',
      model,
      attempts: maxAttempts,
    }
  )
}

/** Bound conversation history for chat cost control. */
export function trimChatHistory(
  messages: Array<{ role: string; content: string }>,
  options?: { maxMessages?: number; maxCharsPerMessage?: number },
) {
  const config = getAiRuntimeConfig()
  const maxMessages = options?.maxMessages ?? config.chat.maxHistoryMessages
  const maxChars = options?.maxCharsPerMessage ?? config.chat.maxHistoryCharsPerMessage
  return messages.slice(0, maxMessages).map((message) => {
    const content =
      message.content.length > maxChars
        ? `${message.content.slice(0, maxChars)}\n…[truncated for length]`
        : message.content
    return { role: message.role, content }
  })
}
