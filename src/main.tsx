import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { useTranslation } from 'react-i18next'
import { registerSW } from 'virtual:pwa-register'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { QueryProvider } from '@/lib/query/client'
import { AppRouter } from '@/app/router'
import { ThemeProvider, useTheme } from '@/hooks/useTheme'
import { NotificationListener } from '@/features/notifications/NotificationListener'
import { WorkspaceRealtime } from '@/features/home/WorkspaceRealtime'
import '@/i18n'
import '@/styles/globals.css'

registerSW({ immediate: true })

function App() {
  const { i18n } = useTranslation()
  const { theme } = useTheme()
  const isRtl = i18n.language.startsWith('ar')

  useEffect(() => {
    document.documentElement.lang = isRtl ? 'ar' : 'en'
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
  }, [isRtl])

  return (
    <QueryProvider>
      <AuthProvider>
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
