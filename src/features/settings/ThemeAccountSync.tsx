import { useEffect, useRef } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { getSettings } from '@/features/settings/api'
import { getThemeWriteGeneration, useTheme, type ThemeMode } from '@/hooks/useTheme'

/**
 * Once per signed-in user, apply the account theme from the DB so preference
 * survives refresh / new browsers. Local toggles persist immediately via setTheme.
 */
export function ThemeAccountSync() {
  const { user } = useAuth()
  const { hydrateTheme } = useTheme()
  const syncedUserId = useRef<string | null>(null)

  useEffect(() => {
    if (!user) {
      syncedUserId.current = null
      return
    }
    if (syncedUserId.current === user.id) return

    let cancelled = false
    const generationAtStart = getThemeWriteGeneration()
    void (async () => {
      try {
        const settings = await getSettings()
        if (cancelled) return
        // User changed theme while settings were loading — keep their choice.
        if (getThemeWriteGeneration() !== generationAtStart) {
          syncedUserId.current = user.id
          return
        }
        const next = settings.theme
        if (next === 'light' || next === 'dark') {
          hydrateTheme(next as ThemeMode)
          syncedUserId.current = user.id
        }
      } catch {
        // Keep whatever boot.js / localStorage already applied.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, hydrateTheme])

  return null
}
