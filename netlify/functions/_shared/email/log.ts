/**
 * Structured email logs. Only operational fields are accepted: never addresses, subjects, bodies,
 * tokens or provider error messages (which can echo addresses).
 */
export type EmailLogFields = {
  template?: string
  category?: string
  outcome?: 'sent' | 'skipped' | 'retry' | 'failed' | 'disabled' | 'received' | 'ignored'
  code?: string
  status?: number | null
  messageId?: string
  outboxIds?: string[]
  items?: number
  attempts?: number
  durationMs?: number
}

export type EmailLogger = (event: string, fields?: EmailLogFields) => void

export const logEmail: EmailLogger = (event, fields = {}) => {
  const line = JSON.stringify({ scope: 'email', event, ...fields })
  if (fields.outcome === 'failed') console.error(line)
  else if (fields.outcome === 'retry') console.warn(line)
  else console.info(line)
}
