import { Skeleton } from '@/components/ui/page'
import { MeetingsListView } from '@/shared/meetings'
import { useWorkspaceMeetingsAdapter } from './useWorkspaceMeetingsAdapter'

export function WorkspaceMeetingsTab({ project }: { project: { id: string; name: string } }) {
  const adapter = useWorkspaceMeetingsAdapter(project)
  if (!adapter) return <Skeleton className="h-48" />
  return <MeetingsListView adapter={adapter} />
}
