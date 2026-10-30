import { describe, expect, it } from 'vitest'
import { appLink, escapeHtml, isValidEmailAddress, singleLine } from './text.ts'

describe('escapeHtml', () => {
  it('escapes markup and attribute breakers', () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;',
    )
  })
})

describe('singleLine', () => {
  it('removes line breaks and control characters (no header injection)', () => {
    expect(singleLine('Ship it\r\nBcc: someone@example.com')).toBe('Ship it Bcc: someone@example.com')
    expect(singleLine('a\u0000b\u202ec\u2028d')).toBe('a b c d')
  })

  it('clamps long text with an ellipsis', () => {
    expect(singleLine('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`)
    expect(singleLine(null)).toBe('')
  })
})

describe('isValidEmailAddress', () => {
  it('accepts plain addresses', () => {
    expect(isValidEmailAddress('person@example.com')).toBe(true)
    expect(isValidEmailAddress('first.last+tag@sub.example.co')).toBe(true)
  })

  it.each([
    '',
    'not-an-email',
    'person@localhost',
    'Person <person@example.com>',
    'a@example.com, b@example.com',
    'a@example.com\r\nBcc: b@example.com',
    ' person@example.com',
    'a..b@example.com',
    `${'a'.repeat(250)}@example.com`,
  ])('rejects %j', (value) => {
    expect(isValidEmailAddress(value)).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isValidEmailAddress(undefined)).toBe(false)
    expect(isValidEmailAddress(42)).toBe(false)
  })
})

describe('appLink', () => {
  it('builds links under the app origin only', () => {
    expect(appLink('https://app.hilm.tech', '/personal/tasks/1')).toBe('https://app.hilm.tech/personal/tasks/1')
    expect(() => appLink('https://app.hilm.tech', 'https://evil.example')).toThrow()
    expect(() => appLink('https://app.hilm.tech', '//evil.example')).toThrow()
  })
})
