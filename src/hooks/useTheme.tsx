import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase/client'

export type ThemeMode = 'dark' | 'light'

type ThemeContextValue = {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  /** Apply theme locally without writing to the account (used when hydrating from DB). */
  hydrateTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
export const THEME_STORAGE_KEY = 'hilm-theme'

/** Bumps when the user changes theme so a slow DB hydrate cannot clobber it. */
let themeWriteGeneration = 0

export function getThemeWriteGeneration() {
  return themeWriteGeneration
}

export function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function writeStoredTheme(theme: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Private mode / blocked storage — DOM theme still applies for this session.
  }
}

function syncThemeColorMeta(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  const color = theme === 'light' ? '#f7f7f8' : '#0a0a0b'
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', color)
  }
  const scheme = document.querySelector('meta[name="color-scheme"]')
  if (scheme) scheme.setAttribute('content', theme)
}

export function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  syncThemeColorMeta(theme)
}

async function persistThemeToAccount(theme: ThemeMode) {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return
    const { updateSettings } = await import('@/shared/user-settings')
    await updateSettings({ theme })
  } catch {
    // Keep the local preference; next successful save/sync can reconcile.
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme())

  useEffect(() => {
    applyTheme(theme)
    writeStoredTheme(theme)
  }, [theme])

  const hydrateTheme = useCallback((next: ThemeMode) => {
    setThemeState(next)
    writeStoredTheme(next)
    applyTheme(next)
  }, [])

  const setTheme = useCallback((next: ThemeMode) => {
    themeWriteGeneration += 1
    setThemeState(next)
    writeStoredTheme(next)
    applyTheme(next)
    void persistThemeToAccount(next)
  }, [])

  const toggleTheme = useCallback(() => {
    themeWriteGeneration += 1
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      writeStoredTheme(next)
      applyTheme(next)
      void persistThemeToAccount(next)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ theme, setTheme, hydrateTheme, toggleTheme }),
    [theme, setTheme, hydrateTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
