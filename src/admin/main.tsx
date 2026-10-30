import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AdminAuth, ReauthDialog } from '@/admin/AdminAuth'
import { setReauthHandler } from '@/admin/client'
import { AccountsPage, AiPage, AuditPage, EmailsPage, OverviewPage, SecurityPage } from '@/admin/pages'
import '@/styles/globals.css'

const IDLE_LIMIT_MS = 15 * 60 * 1000
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })

const NAV = [
  ['/', 'Overview'],
  ['/ai', 'AI costs'],
  ['/accounts', 'Accounts'],
  ['/emails', 'Product emails'],
  ['/security', 'Security'],
  ['/audit', 'Audit log'],
] as const

function Shell({ email, network, signOut }: { email: string | null; network: string; signOut: () => Promise<void> }) {
  const [reauth, setReauth] = useState<((ok: boolean) => void) | null>(null)

  useEffect(() => {
    setReauthHandler(() => new Promise<boolean>((resolve) => setReauth(() => resolve)))
    return () => setReauthHandler(null)
  }, [])

  // Sign out after 15 minutes without interaction.
  const last = useRef(Date.now())
  useEffect(() => {
    const touch = () => {
      last.current = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'scroll'] as const
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const timer = window.setInterval(() => {
      if (Date.now() - last.current > IDLE_LIMIT_MS) void signOut()
    }, 30_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch))
      window.clearInterval(timer)
    }
  }, [signOut])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-sm font-medium">Hilm console</p>
            <p className="text-xs text-muted">
              {email} · <span className="font-mono">{network}</span>
            </p>
          </div>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn('rounded-full px-3 py-1.5 transition-colors', isActive ? 'bg-surface-2 text-foreground' : 'text-muted hover:text-foreground')
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-6">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/ai" element={<AiPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/emails" element={<EmailsPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ReauthDialog
        open={Boolean(reauth)}
        onDone={(ok) => {
          reauth?.(ok)
          setReauth(null)
        }}
      />
    </div>
  )
}

document.documentElement.dataset.theme = 'dark'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AdminAuth>{(session, signOut) => <Shell email={session.email} network={session.network} signOut={signOut} />}</AdminAuth>
      </BrowserRouter>
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
)
