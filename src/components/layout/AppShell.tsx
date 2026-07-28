import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  Brain,
  CheckSquare,
  FolderKanban,
  Home,
  Search,
  UserRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { OfflineBanner } from '@/components/layout/OfflineBanner'
import { useOnline } from '@/hooks/useOnline'
import { CommandPalette } from '@/features/command-palette/CommandPalette'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export function AppShell() {
  const location = useLocation()
  const online = useOnline()
  const { t } = useTranslation()

  const nav = [
    { to: '/app', label: t('nav.home'), icon: Home, end: true },
    { to: '/app/projects', label: t('nav.projects'), icon: FolderKanban },
    { to: '/app/tasks', label: t('nav.tasks'), icon: CheckSquare },
    { to: '/app/ai', label: t('nav.ai'), icon: Brain },
    { to: '/app/profile', label: t('nav.profile'), icon: UserRound },
  ]

  return (
    <div className="relative min-h-dvh bg-background">
      <CommandPalette />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(255,255,255,0.03),_transparent_40%),radial-gradient(ellipse_at_bottom_right,_rgba(96,165,250,0.05),_transparent_45%)]" />

      <aside className="fixed inset-y-0 start-0 z-40 hidden w-60 flex-col border-e border-border-subtle bg-surface/60 px-3 py-5 backdrop-blur-xl lg:flex">
        <div className="mb-8 px-3">
          <p className="text-lg font-medium tracking-tight">{t('brand.name')}</p>
          <p className="text-xs text-muted">{t('brand.tagline')}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-surface-2 text-foreground'
                    : 'text-muted hover:bg-surface-2/70 hover:text-foreground',
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2">
          <LanguageSwitcher className="w-full justify-between" />
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('hilm:open-command'))}
            className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            <Search className="size-4" />
            <span className="flex-1 text-start">{t('common.search')}</span>
            <kbd className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-fg">
              ⌘K
            </kbd>
          </button>
        </div>
      </aside>

      <div className="relative lg:ps-60">
        {!online ? <OfflineBanner /> : null}
        <main className="mx-auto min-h-dvh w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6 lg:pb-10 lg:pt-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px]',
                  isActive ? 'text-foreground' : 'text-muted',
                )
              }
            >
              <item.icon className="size-5" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
