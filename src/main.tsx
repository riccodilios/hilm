import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { useTranslation } from 'react-i18next'
import { registerSW } from 'virtual:pwa-register'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { QueryProvider } from '@/lib/query/client'
import { AppRouter } from '@/app/router'
import { ThemeProvider, useTheme } from '@/hooks/useTheme'
import { ThemeAccountSync } from '@/features/settings/ThemeAccountSync'
import { AccountLocaleSync } from '@/features/settings/AccountLocaleSync'
import { requestAppReload } from '@/lib/app-update'
import { NotificationListener } from '@/features/notifications/NotificationListener'
import { WorkspaceRealtime } from '@/features/home/WorkspaceRealtime'
import { arabicPublicPath } from '@/lib/domains'
import i18n from '@/i18n'
import '@/styles/globals.css'

// Arabic visitors (saved choice, or browser language on a first visit) get the /ar version of an
// English public page. Rewritten before the first render so the English page never flashes.
const arabicPath = arabicPublicPath(window.location, i18n.resolvedLanguage ?? i18n.language)
if (arabicPath) window.history.replaceState(null, '', arabicPath)

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true)
  },
  onNeedReload: requestAppReload,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => {
      void registration.update()
    }
    check()
    setInterval(check, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  },
})

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', requestAppReload)
}

function App() {
  const { i18n } = useTranslation()
  const { theme } = useTheme()
  const isRtl = i18n.language.startsWith('ar')

  useEffect(() => {
    // Public marketing pages take their language from the URL (see PublicPage).
    if (document.documentElement.dataset.publicLocale) return
    document.documentElement.lang = isRtl ? 'ar' : 'en'
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
  }, [isRtl])

  return (
    <QueryProvider>
      <AuthProvider>
        <ThemeAccountSync />
        <AccountLocaleSync />
        <NotificationListener />
        <WorkspaceRealtime />
        <AppRouter />
        <Toaster
          theme={theme}
          position={isRtl ? 'bottom-left' : 'bottom-right'}
          richColors
          closeButton
          dir={isRtl ? 'rtl' : 'ltr'}
        />
      </AuthProvider>
    </QueryProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
