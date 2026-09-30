let holds = 0
let pendingReload = false
let reloading = false

function reloadNow() {
  if (reloading) return
  reloading = true
  window.location.reload()
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden' && pendingReload && holds === 0) reloadNow()
}

/**
 * Reload onto a freshly deployed version. While something holds updates (for example an
 * ongoing meeting recording) the reload waits, then happens the next time the app is
 * backgrounded so the user is never interrupted mid-task.
 */
export function requestAppReload() {
  if (holds === 0 && !pendingReload) {
    reloadNow()
    return
  }
  if (!pendingReload) {
    pendingReload = true
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
}

/** Blocks update reloads until the returned release function is called. */
export function holdAppUpdates(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds = Math.max(0, holds - 1)
    if (holds === 0 && pendingReload && document.visibilityState === 'hidden') reloadNow()
  }
}
