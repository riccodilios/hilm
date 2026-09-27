import { Skeleton } from '@/components/ui/page'
import { MeetingsListView } from '@/shared/meetings'
import { usePersonalMeetingsAdapter } from './usePersonalMeetingsAdapter'

export function PersonalMeetingsTab({ project }: { project: { id: string; name: string } }) {
  const adapter = usePersonalMeetingsAdapter(project)
  if (!adapter) return <Skeleton className="h-48" />
  return <MeetingsListView adapter={adapter} />
}
