import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Keeps the layout viewport stable across route changes on iOS Safari / PWA.
 * Residual input focus (and any prior auto-zoom) is cleared so the next page
 * does not open at an unexpected scale.
 */
export function useIosNavigationViewportFix() {
  const location = useLocation()

  useEffect(() => {
    const active = document.activeElement
    if (
      active instanceof HTMLElement &&
      (active.matches('input, textarea, select') || active.isContentEditable)
    ) {
      active.blur()
    }

    // Instant scroll reset avoids a “stuck zoomed” layout after keyboard/nav.
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname, location.search])
}
