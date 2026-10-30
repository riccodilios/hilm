import { describe, expect, it } from 'vitest'
import { domainRedirect, isPublicSitePath } from './domains'

const at = (host: string, pathname: string, search = '', hash = '') => domainRedirect({ host, pathname, search, hash })

describe('domainRedirect', () => {
  it('keeps every public page, in both languages, on hilm.tech', () => {
    for (const path of ['/', '/personal-os', '/workspace-os', '/meetings', '/features', '/privacy', '/ar', '/ar/meetings', '/ar/privacy']) {
      expect(at('hilm.tech', path)).toBeNull()
    }
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

  it('starts the app at sign-in and sends public pages back to hilm.tech', () => {
    expect(at('app.hilm.tech', '/')).toEqual({ kind: 'internal', to: '/login' })
    expect(at('app.hilm.tech', '/privacy')).toEqual({ kind: 'external', url: 'https://hilm.tech/privacy' })
    expect(at('app.hilm.tech', '/ar/meetings')).toEqual({ kind: 'external', url: 'https://hilm.tech/ar/meetings' })
    expect(at('app.hilm.tech', '/personal')).toBeNull()
    expect(at('app.hilm.tech', '/shared/meeting/abc')).toBeNull()
  })

  it('forwards the retired Netlify host to the matching new address', () => {
    expect(at('hillm.netlify.app', '/')).toEqual({ kind: 'external', url: 'https://hilm.tech/' })
    expect(at('hillm.netlify.app', '/features')).toEqual({ kind: 'external', url: 'https://hilm.tech/features' })
    expect(at('hillm.netlify.app', '/personal/tasks', '?x=1')).toEqual({ kind: 'external', url: 'https://app.hilm.tech/personal/tasks?x=1' })
  })

  it('leaves local and preview hosts untouched', () => {
    for (const host of ['localhost:5173', 'deploy-preview-12--hillm.netlify.app']) {
      expect(at(host, '/')).toBeNull()
      expect(at(host, '/personal')).toBeNull()
      expect(at(host, '/ar/privacy')).toBeNull()
    }
  })

  it('classifies public pages only', () => {
    expect(isPublicSitePath('/meetings')).toBe(true)
    expect(isPublicSitePath('/ar')).toBe(true)
    expect(isPublicSitePath('/personal/projects/1/meetings/2')).toBe(false)
    expect(isPublicSitePath('/shared/meeting/abc')).toBe(false)
  })
})
