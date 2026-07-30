import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Brain,
  CheckSquare,
  ChevronDown,
  FolderKanban,
  Home,
  LayoutGrid,
  Plus,
  UserRound,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { OfflineBanner } from '@/components/layout/OfflineBanner'
import { RouteErrorBoundary } from '@/components/layout/RouteErrorBoundary'
import { useOnline } from '@/hooks/useOnline'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { WorkspaceProvider, useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { listMyWorkspaces, workspaceKeys } from '@/features/workspace-os/api'
import { Button } from '@/components/ui/button'
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
  const { workspaceId } = useParams()
  const base = `/workspace/${workspaceId}`

  const nav = [
    { to: base, label: t('nav.home'), icon: Home, end: true },
    { to: `${base}/projects`, label: t('nav.projects'), icon: FolderKanban },
    { to: `${base}/tasks`, label: t('nav.tasks'), icon: CheckSquare },
    { to: `${base}/team`, label: t('nav.team'), icon: Users },
    { to: `${base}/ai`, label: t('nav.ai'), icon: Brain },
    { to: '/personal', label: t('nav.personal'), icon: LayoutGrid },
    { to: `${base}/profile`, label: t('nav.profile'), icon: UserRound },
  ]

  const mobileNav = [
    { to: base, label: t('nav.home'), icon: Home, end: true },
    { to: `${base}/projects`, label: t('nav.projects'), icon: FolderKanban },
    { to: `${base}/tasks`, label: t('nav.tasks'), icon: CheckSquare },
    { to: `${base}/team`, label: t('nav.team'), icon: Users },
    { to: `${base}/ai`, label: t('nav.ai'), icon: Brain },
    { to: '/personal', label: t('nav.personal'), icon: LayoutGrid },
    { to: `${base}/profile`, label: t('nav.profile'), icon: UserRound },
  ]

  return (
    <div className="relative min-h-dvh bg-background">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(96,165,250,0.06),_transparent_40%),radial-gradient(ellipse_at_bottom_left,_rgba(255,255,255,0.03),_transparent_45%)]" />

      <aside className="fixed inset-y-0 start-0 z-40 hidden w-60 flex-col border-e border-border-subtle bg-surface/60 px-3 py-5 backdrop-blur-xl lg:flex">
        <div className="mb-4">
          <Link to="/workspace" className="mb-3 block px-2 text-lg font-medium tracking-tight">
            {t('brand.name')}
          </Link>
          <WorkspaceSwitcher />
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
        <div className="mt-auto">
          <LanguageSwitcher className="w-full justify-between" />
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
      <WorkspaceShellInner />
    </WorkspaceProvider>
  )
}
