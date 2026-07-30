import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getWorkspaceHome, workspaceKeys } from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { Card, CardContent } from '@/components/ui/card'

export function WorkspaceHomePage() {
  const { t } = useTranslation()
  const { workspaceId, workspace } = useWorkspace()
  const home = useQuery({
    queryKey: workspaceKeys.home(workspaceId),
    queryFn: () => getWorkspaceHome(workspaceId),
  })

  if (home.isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-56" /><Skeleton className="h-40" /></div>

  const data = home.data!

  return (
    <div>
      <PageHeader
        title={workspace.name}
        description={workspace.description || t('workspace.homeDesc')}
      />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t('workspace.members'), data.memberCount],
          [t('nav.projects'), data.projectCount],
          [t('workspace.openTasks'), data.openTaskCount],
          [t('workspace.doneTasks'), data.doneTaskCount],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="p-4">
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">{t('nav.projects')}</h2>
            <Link to={`/workspace/${workspaceId}/projects`} className="text-xs text-accent hover:underline">
              {t('common.viewAll')}
            </Link>
          </div>
          <div className="space-y-2">
            {data.projects.map((project) => (
              <Link
                key={project.id}
                to={`/workspace/${workspaceId}/projects/${project.id}`}
                className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface/40 px-3 py-3 hover:bg-surface"
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: project.color }} />
                <span className="truncate text-sm">{project.name}</span>
              </Link>
            ))}
            {!data.projects.length ? <p className="text-sm text-muted">{t('workspace.noProjects')}</p> : null}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">{t('workspace.recentActivity')}</h2>
            <Link to={`/workspace/${workspaceId}/activity`} className="text-xs text-accent hover:underline">
              {t('common.viewAll')}
            </Link>
          </div>
          <div className="space-y-2">
            {data.recentActivity.map((event) => (
              <div key={event.id} className="rounded-xl border border-border-subtle bg-surface/40 px-3 py-3">
                <p className="text-sm">{event.summary}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {new Date(event.created_at).toLocaleString()}
                </p>
              </div>
            ))}
            {!data.recentActivity.length ? <p className="text-sm text-muted">{t('workspace.noActivity')}</p> : null}
          </div>
        </section>
      </div>
    </div>
  )
}
