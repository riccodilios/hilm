import { describe, expect, it } from 'vitest'
import { isSafeAuthNext, parseAuthCallbackParams } from '@/lib/auth-callback-params'

describe('auth callback helpers', () => {
  it('allows onboarding and blocks external redirects', () => {
    expect(isSafeAuthNext('/onboarding')).toBe(true)
    expect(isSafeAuthNext('/personal/tasks')).toBe(true)
    expect(isSafeAuthNext('https://evil.test')).toBe(false)
    expect(isSafeAuthNext('//evil.test')).toBe(false)
  })

  it('parses otp callback params', () => {
    const params = parseAuthCallbackParams(
      new URLSearchParams('token_hash=abc&type=signup&email=user@test.com'),
    )
    expect(params.tokenHash).toBe('abc')
    expect(params.type).toBe('signup')
    expect(params.email).toBe('user@test.com')
  })
})
