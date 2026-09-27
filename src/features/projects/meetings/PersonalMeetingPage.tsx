import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/page'
import { getProject, projectsKeys } from '@/features/projects/api'
import { MeetingDetailView } from '@/shared/meetings'
import { usePersonalMeetingsAdapter } from './usePersonalMeetingsAdapter'

export function PersonalMeetingPage() {
  const { t } = useTranslation()
  const { id, meetingId } = useParams()
  const { data: project, isLoading } = useQuery({
    queryKey: projectsKeys.detail(id ?? ''),
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
  })
  const adapter = usePersonalMeetingsAdapter(project)

  if (isLoading) return <Skeleton className="h-64" />
  if (!project || !meetingId) {
    return (
      <EmptyState
        title={t('meetings.notFound')}
        action={
          <Button asChild>
            <Link to="/personal/projects">{t('nav.projects', { defaultValue: 'Projects' })}</Link>
          </Button>
        }
      />
    )
  }
  if (!adapter) return <Skeleton className="h-64" />
  return <MeetingDetailView adapter={adapter} meetingId={meetingId} />
}
