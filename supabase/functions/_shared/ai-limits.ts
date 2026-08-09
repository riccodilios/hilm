/** Server-side AI request limits shared by Netlify + Edge. */

export const AI_MAX_MESSAGE_CHARS = 12_000
export const AI_MAX_IDEMPOTENCY_KEY = 128

const DEFAULT_ALLOWED_MODELS = [
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'google/gemini-2.0-flash',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1',
  'openai/gpt-4o-mini',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-3.5-sonnet',
  'meta-llama/llama-3.3-70b-instruct',
]

export function allowedAiModels(envValue?: string | null) {
  const fromEnv = (envValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return new Set(fromEnv.length ? fromEnv : DEFAULT_ALLOWED_MODELS)
}

export function resolveAllowedAiModel(input: {
  requested?: string | null
  conversationModel?: string | null
  defaultModel: string
  allowedEnv?: string | null
}) {
  const allowed = allowedAiModels(input.allowedEnv)
  const fallback = allowed.has(input.defaultModel)
    ? input.defaultModel
    : [...allowed][0] || input.defaultModel

  for (const candidate of [input.requested, input.conversationModel, fallback]) {
    const model = candidate?.trim()
    if (model && allowed.has(model)) return model
  }
  return fallback
}

export function assertAiMessageLength(message: string) {
  if (message.length > AI_MAX_MESSAGE_CHARS) {
    return `Message is too long (max ${AI_MAX_MESSAGE_CHARS} characters)`
  }
  return null
}
