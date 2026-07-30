import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Brain,
  Building2,
  CheckSquare,
  Crosshair,
  FolderKanban,
  Home,
  Search,
  UserRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { OfflineBanner } from '@/components/layout/OfflineBanner'
import { RouteErrorBoundary } from '@/components/layout/RouteErrorBoundary'
import { useOnline } from '@/hooks/useOnline'
import { CommandPalette } from '@/features/command-palette/CommandPalette'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export function PersonalShell() {
  const online = useOnline()
  const { t } = useTranslation()

  const nav = [
    { to: '/personal', label: t('nav.home'), icon: Home, end: true },
    { to: '/personal/mission-control', label: t('nav.mission'), icon: Crosshair },
    { to: '/personal/projects', label: t('nav.projects'), icon: FolderKanban },
    { to: '/personal/tasks', label: t('nav.tasks'), icon: CheckSquare },
    { to: '/personal/workspace', label: t('nav.workspace'), icon: Building2 },
    { to: '/personal/ai', label: t('nav.ai'), icon: Brain },
    { to: '/personal/profile', label: t('nav.profile'), icon: UserRound },
  ]

  return (
    <div className="relative min-h-dvh bg-background">
      <CommandPalette />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(255,255,255,0.03),_transparent_40%),radial-gradient(ellipse_at_bottom_right,_rgba(96,165,250,0.05),_transparent_45%)]" />

      <aside className="fixed inset-y-0 start-0 z-40 hidden w-60 flex-col border-e border-border-subtle bg-surface/60 px-3 py-5 backdrop-blur-xl lg:flex">
        <div className="mb-8 px-3">
          <p className="text-lg font-medium tracking-tight">{t('brand.name')}</p>
          <p className="text-xs text-muted">{t('os.personal')}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
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
        <main className="mx-auto min-h-dvh w-full max-w-6xl overflow-x-hidden px-4 pb-24 pt-6 sm:px-6 lg:pb-10 lg:pt-8">
          <RouteErrorBoundary title={t('common.pageError')}>
            <div className="w-full min-w-0">
              <Outlet />
            </div>
          </RouteErrorBoundary>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between gap-0.5 overflow-x-auto">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-w-[3.25rem] flex-1 flex-col items-center gap-1 py-2.5 text-[9px]',
                  isActive ? 'text-foreground' : 'text-muted',
                )
              }
            >
              <item.icon className="size-4" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
