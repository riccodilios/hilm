import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = () => void

function setupDom() {
  const listeners = new Set<Listener>()
  const doc = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  }
  const reload = vi.fn()
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', { location: { reload } })
  const hide = () => {
    doc.visibilityState = 'hidden'
    listeners.forEach((fn) => fn())
  }
  return { reload, hide }
}

async function loadModule() {
  vi.resetModules()
  return import('./app-update')
}

describe('app update reloads', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('reloads immediately when nothing holds updates', async () => {
    const { reload } = setupDom()
    const { requestAppReload } = await loadModule()
    requestAppReload()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads while held, even when the app is backgrounded', async () => {
    const { reload, hide } = setupDom()
    const { requestAppReload, holdAppUpdates } = await loadModule()
    holdAppUpdates()
    requestAppReload()
    hide()
    expect(reload).not.toHaveBeenCalled()
  })

  it('waits for the next backgrounding after the hold is released', async () => {
    const { reload, hide } = setupDom()
    const { requestAppReload, holdAppUpdates } = await loadModule()
    const release = holdAppUpdates()
    requestAppReload()
    release()
    expect(reload).not.toHaveBeenCalled()
    hide()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
