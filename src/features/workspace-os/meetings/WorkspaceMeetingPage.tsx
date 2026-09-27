import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/page'
import { getWorkspaceProject, workspaceKeys } from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { MeetingDetailView } from '@/shared/meetings'
import { useWorkspaceMeetingsAdapter } from './useWorkspaceMeetingsAdapter'

export function WorkspaceMeetingPage() {
  const { t } = useTranslation()
  const { projectId = '', meetingId } = useParams()
  const { workspaceId } = useWorkspace()
  const { data: project, isLoading } = useQuery({
    queryKey: workspaceKeys.project(workspaceId, projectId),
    queryFn: () => getWorkspaceProject(workspaceId, projectId),
    enabled: Boolean(workspaceId && projectId),
  })
  const adapter = useWorkspaceMeetingsAdapter(project)

  if (isLoading) return <Skeleton className="h-64" />
  if (!project || !meetingId) {
    return (
      <EmptyState
        title={t('meetings.notFound')}
        action={
          <Button asChild>
            <Link to={`/workspace/${workspaceId}/projects`}>{t('nav.projects', { defaultValue: 'Projects' })}</Link>
          </Button>
        }
      />
    )
  }
  if (!adapter) return <Skeleton className="h-64" />
  return <MeetingDetailView adapter={adapter} meetingId={meetingId} />
}
