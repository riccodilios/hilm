export function formatAiLimitError(payload: {
  error?: string
  code?: string
  message?: string
}) {
  const code = payload.code
  const fallback = payload.error || payload.message || 'AI request failed'
  switch (code) {
    case 'rate_limited':
      return 'You are sending AI requests too quickly. Please wait a moment and try again.'
    case 'daily_request_limit':
      return 'You have reached your daily AI request limit. It resets at midnight UTC.'
    case 'monthly_request_limit':
      return 'You have reached your monthly AI request limit.'
    case 'daily_token_limit':
      return 'You have reached your daily AI token quota.'
    case 'monthly_token_limit':
      return 'You have reached your monthly AI token quota.'
    case 'daily_cost_limit':
      return 'You have reached your daily AI spend limit.'
    case 'monthly_cost_limit':
      return 'You have reached your monthly AI spend limit.'
    case 'concurrent_limit':
    case 'in_flight':
    case 'duplicate_execution':
      return 'Another AI request is already running. Please wait for it to finish.'
    case 'duplicate':
      return 'This AI request was already submitted.'
    case 'tier_disabled':
      return 'AI access is disabled for your plan. Contact support.'
    default:
      return fallback
  }
}
