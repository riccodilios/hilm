import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Brain,
  Building2,
  CheckSquare,
  ChevronDown,
  FolderKanban,
  Home,
  LayoutGrid,
  Network,
  Plus,
  Search,
  UserRound,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { OfflineBanner } from '@/components/layout/OfflineBanner'
import { RouteErrorBoundary } from '@/components/layout/RouteErrorBoundary'
import { useOnline } from '@/hooks/useOnline'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { WorkspaceCommandPalette } from '@/features/workspace-os/components/WorkspaceCommandPalette'
import { WorkspaceProvider, useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { WorkspaceOsRealtime } from '@/features/workspace-os/components/WorkspaceOsRealtime'
import { OrgVisibilityProvider } from '@/features/workspace-os/context/OrgVisibilityProvider'
import { WorkspacePageGate } from '@/features/workspace-os/components/RequireWorkspacePage'
import { listMyWorkspaces, workspaceKeys } from '@/features/workspace-os/api'
import { getSettings, settingsKeys } from '@/features/settings/api'
import { Button } from '@/components/ui/button'
import { useIosNavigationViewportFix } from '@/hooks/useIosNavigationViewportFix'
import { useState } from 'react'

function WorkspaceSwitcher() {
  const { t } = useTranslation()
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const list = useQuery({ queryKey: workspaceKeys.list(), queryFn: listMyWorkspaces })

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-start hover:bg-surface-2/70"
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-medium text-background"
          style={{ backgroundColor: workspace.color }}
        >
          {workspace.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{workspace.name}</span>
          <span className="block text-[10px] text-muted">{t('os.workspace')}</span>
        </span>
        <ChevronDown className="size-4 text-muted" />
      </button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-40" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="absolute start-0 top-full z-50 mt-2 w-64 rounded-2xl border border-border bg-surface p-2 shadow-xl">
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted">{t('workspace.current')}</p>
            <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm">{workspace.name}</div>
            <p className="mt-2 px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
              {t('workspace.otherWorkspaces')}
            </p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {(list.data ?? [])
                .filter((item) => item.id !== workspace.id)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-start text-sm hover:bg-surface-2"
                    onClick={() => {
                      setOpen(false)
                      navigate(`/workspace/${item.id}`)
                    }}
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate">{item.name}</span>
                  </button>
                ))}
            </div>
            <div className="mt-2 space-y-1 border-t border-border-subtle pt-2">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false)
                  navigate('/workspace?create=1')
                }}
              >
                <Plus className="size-4" /> {t('workspace.create')}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false)
                  navigate('/workspace?join=1')
                }}
              >
                {t('workspace.join')}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false)
                  navigate('/workspace')
                }}
              >
                <LayoutGrid className="size-4" /> {t('workspace.allWorkspaces')}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function WorkspaceShellInner() {
  const online = useOnline()
  const { t } = useTranslation()
  useIosNavigationViewportFix()
  const { workspaceId, canReadPage } = useWorkspace()
  const base = `/workspace/${workspaceId}`
  const settings = useQuery({ queryKey: settingsKeys.me(), queryFn: getSettings })
  const hidePersonal = settings.data?.hide_personal_os ?? false

  const nav = [
    { to: base, label: t('nav.home'), icon: Home, end: true, group: 'work' as const, page: 'home' as const },
    { to: `${base}/projects`, label: t('nav.projects'), icon: FolderKanban, group: 'work' as const, page: 'projects' as const },
    { to: `${base}/tasks`, label: t('nav.tasks'), icon: CheckSquare, group: 'work' as const, page: 'tasks' as const },
    { to: `${base}/ai`, label: t('nav.ai'), icon: Brain, group: 'work' as const, page: 'ai' as const },
    { to: `${base}/team`, label: t('nav.team'), icon: Users, group: 'people' as const, page: 'team' as const },
    { to: `${base}/org`, label: t('nav.org'), icon: Network, group: 'people' as const, page: 'org' as const },
    { to: `${base}/crm`, label: t('nav.crm'), icon: Building2, group: 'people' as const, page: 'crm' as const },
    ...(!hidePersonal
      ? [{ to: '/personal', label: t('nav.personal'), icon: LayoutGrid, group: 'account' as const, page: 'home' as const }]
      : []),
    { to: `${base}/profile`, label: t('nav.profile'), icon: UserRound, group: 'account' as const, page: 'profile' as const },
  ].filter((item) => item.to === '/personal' || canReadPage(item.page))

  const mobileNav = [
    { to: base, label: t('nav.home'), icon: Home, end: true, page: 'home' as const },
    { to: `${base}/projects`, label: t('nav.projects'), icon: FolderKanban, page: 'projects' as const },
    { to: `${base}/tasks`, label: t('nav.tasks'), icon: CheckSquare, page: 'tasks' as const },
    { to: `${base}/team`, label: t('nav.team'), icon: Users, page: 'team' as const },
    { to: `${base}/ai`, label: t('nav.ai'), icon: Brain, page: 'ai' as const },
    { to: `${base}/profile`, label: t('nav.profile'), icon: UserRound, page: 'profile' as const },
  ].filter((item) => canReadPage(item.page))

  const navGroups: Array<{ id: 'work' | 'people' | 'account'; label: string }> = [
    { id: 'work', label: t('nav.work') },
    { id: 'people', label: t('nav.people') },
    { id: 'account', label: t('nav.settings') },
  ]

  return (
    <div className="relative min-h-dvh bg-background">
      <WorkspaceOsRealtime />
      <WorkspaceCommandPalette />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(96,165,250,0.06),_transparent_40%),radial-gradient(ellipse_at_bottom_left,_rgba(255,255,255,0.03),_transparent_45%)]" />

      <aside className="fixed inset-y-0 start-0 z-40 hidden w-60 flex-col border-e border-border-subtle bg-surface/60 px-3 pb-5 pt-[max(1.25rem,env(safe-area-inset-top,0px))] backdrop-blur-xl lg:flex">
        <div className="mb-4">
          <Link to="/workspace" className="mb-3 block px-2 text-lg font-medium tracking-tight">
            {t('brand.name')}
          </Link>
          <WorkspaceSwitcher />
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {navGroups.map((group) => {
            const items = nav.filter((item) => item.group === group.id)
            if (!items.length) return null
            return (
              <div key={group.id} className="mb-2">
                <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
                  {group.label}
                </p>
                {items.map((item) => (
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
              </div>
            )
          })}
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
        <main
          className={cn(
            'mx-auto min-h-dvh w-full max-w-6xl overflow-x-hidden',
            'ps-[max(1rem,env(safe-area-inset-left,0px))] pe-[max(1rem,env(safe-area-inset-right,0px))]',
            'pt-[calc(1.5rem+env(safe-area-inset-top,0px))]',
            'pb-[max(6rem,calc(4.5rem+env(safe-area-inset-bottom,0px)))]',
            'sm:ps-[max(1.5rem,env(safe-area-inset-left,0px))] sm:pe-[max(1.5rem,env(safe-area-inset-right,0px))]',
            'lg:pb-10 lg:pt-[calc(2rem+env(safe-area-inset-top,0px))]',
          )}
        >
          <RouteErrorBoundary title={t('common.pageError')}>
            <div className="w-full min-w-0">
              <WorkspacePageGate>
                <Outlet />
              </WorkspacePageGate>
            </div>
          </RouteErrorBoundary>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface/90 px-1 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between gap-0.5 overflow-x-auto">
          {mobileNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-w-[3.25rem] flex-1 flex-col items-center gap-1 py-2.5 text-[10px]',
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

export function WorkspaceShell() {
  return (
    <WorkspaceProvider>
      <OrgVisibilityProvider>
        <WorkspaceShellInner />
      </OrgVisibilityProvider>
    </WorkspaceProvider>
  )
}
