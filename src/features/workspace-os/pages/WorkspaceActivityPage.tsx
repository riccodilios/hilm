import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'
import { listWorkspaceActivity, workspaceKeys } from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { Badge } from '@/components/ui/badge'
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/page'
import { formatRelative } from '@/lib/utils'

export function WorkspaceActivityPage() {
  const { t } = useTranslation()
  const { workspaceId } = useWorkspace()
  const activity = useQuery({
    queryKey: workspaceKeys.activity(workspaceId),
    queryFn: () => listWorkspaceActivity(workspaceId, 100),
  })

  return (
    <div className="max-w-3xl">
      <PageHeader title={t('workspace.activity')} description={t('workspace.activityDesc')} />
      {activity.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : !activity.data?.length ? (
        <EmptyState title={t('workspace.noActivity')} />
      ) : (
        <div className="relative space-y-0 before:absolute before:bottom-5 before:start-4 before:top-5 before:w-px before:bg-border-subtle">
          {activity.data.map((event) => (
            <article key={event.id} className="relative flex gap-4 py-3">
              <div className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted">
                <Activity className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1 rounded-xl border border-border-subtle bg-surface/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{event.summary}</p>
                  <time className="shrink-0 text-xs text-muted">
                    {formatRelative(event.created_at)}
                  </time>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge className="bg-surface-3 text-muted">
                    {(event.entity_type || event.event_type).replace(/[._]/g, ' ')}
                  </Badge>
                  <Badge className="bg-surface-3 text-muted">{event.event_type}</Badge>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
