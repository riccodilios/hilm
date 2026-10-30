import { describe, expect, it } from 'vitest'
import { domainRedirect } from './domains'

const at = (host: string, pathname: string, search = '', hash = '') => domainRedirect({ host, pathname, search, hash })

describe('domainRedirect', () => {
  it('keeps the landing and privacy pages on hilm.tech', () => {
    expect(at('hilm.tech', '/')).toBeNull()
    expect(at('hilm.tech', '/privacy')).toBeNull()
    expect(at('www.hilm.tech', '/privacy/')).toBeNull()
  })

  it('sends every product route on hilm.tech to app.hilm.tech, keeping query and hash', () => {
    expect(at('hilm.tech', '/login')).toEqual({ kind: 'external', url: 'https://app.hilm.tech/login' })
    expect(at('hilm.tech', '/signup')).toEqual({ kind: 'external', url: 'https://app.hilm.tech/signup' })
    expect(at('hilm.tech', '/auth/callback', '?code=abc&next=%2Fonboarding')).toEqual({
      kind: 'external',
      url: 'https://app.hilm.tech/auth/callback?code=abc&next=%2Fonboarding',
    })
    expect(at('hilm.tech', '/personal/projects/p1', '?task=t1')).toEqual({
      kind: 'external',
      url: 'https://app.hilm.tech/personal/projects/p1?task=t1',
    })
    expect(at('hilm.tech', '/shared/meeting/abc')).toEqual({ kind: 'external', url: 'https://app.hilm.tech/shared/meeting/abc' })
  })

  it('starts the app at sign-in and sends privacy back to the public site', () => {
    expect(at('app.hilm.tech', '/')).toEqual({ kind: 'internal', to: '/login' })
    expect(at('app.hilm.tech', '/privacy')).toEqual({ kind: 'external', url: 'https://hilm.tech/privacy' })
    expect(at('app.hilm.tech', '/personal')).toBeNull()
    expect(at('app.hilm.tech', '/shared/meeting/abc')).toBeNull()
  })

  it('leaves other hosts untouched', () => {
    for (const host of ['localhost:5173', 'hillm.netlify.app', 'deploy-preview-12--hillm.netlify.app']) {
      expect(at(host, '/')).toBeNull()
      expect(at(host, '/personal')).toBeNull()
      expect(at(host, '/privacy')).toBeNull()
    }
  })
})
