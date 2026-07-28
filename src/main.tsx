import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { QueryProvider } from '@/lib/query/client'
import { AppRouter } from '@/app/router'
import '@/styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryProvider>
      <AuthProvider>
        <AppRouter />
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </AuthProvider>
    </QueryProvider>
  </StrictMode>,
)
