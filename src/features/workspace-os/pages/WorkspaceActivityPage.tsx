import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listWorkspaceActivity, workspaceKeys } from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { PageHeader, Skeleton } from '@/components/ui/page'

export function WorkspaceActivityPage() {
  const { t } = useTranslation()
  const { workspaceId } = useWorkspace()
  const activity = useQuery({
    queryKey: workspaceKeys.activity(workspaceId),
    queryFn: () => listWorkspaceActivity(workspaceId),
  })

  return (
    <div>
      <PageHeader title={t('workspace.activity')} description={t('workspace.activityDesc')} />
      {activity.isLoading ? (
        <div className="mt-6 space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      ) : (
        <div className="mt-6 space-y-2">
          {(activity.data ?? []).map((event) => (
            <div key={event.id} className="rounded-2xl border border-border-subtle bg-surface/40 px-4 py-3">
              <p className="text-sm">{event.summary}</p>
              <p className="mt-1 text-[11px] text-muted">
                {event.event_type} · {new Date(event.created_at).toLocaleString()}
              </p>
            </div>
          ))}
          {!activity.data?.length ? <p className="text-sm text-muted">{t('workspace.noActivity')}</p> : null}
        </div>
      )}
    </div>
  )
}
