/**
 * One-click unsubscribe tokens: HMAC-SHA256(secret, "unsubscribe:<userId>"). They do not expire,
 * so links in old emails keep working; rotating EMAIL_UNSUBSCRIBE_SECRET invalidates them all.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { isUuid } from './text.ts'

function signature(secret: string, userId: string) {
  return createHmac('sha256', secret).update(`unsubscribe:${userId.toLowerCase()}`).digest('base64url')
}

export function unsubscribeToken(secret: string, userId: string) {
  return signature(secret, userId)
}

export function verifyUnsubscribeToken(secret: string, userId: unknown, token: unknown): userId is string {
  if (!isUuid(userId) || typeof token !== 'string' || token.length > 100) return false
  const expected = Buffer.from(signature(secret, userId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function unsubscribeUrl(appBaseUrl: string, secret: string, userId: string) {
  return `${appBaseUrl}/api/email-unsubscribe?u=${userId}&t=${unsubscribeToken(secret, userId)}`
}
