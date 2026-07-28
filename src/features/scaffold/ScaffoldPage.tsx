import { PageHeader } from '@/components/ui/page'
import { EmptyState } from '@/components/ui/page'

export function ScaffoldPage({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <EmptyState
        title="Scaffolded for expansion"
        description="Schema and navigation are ready. Full UI ships in a later phase."
      />
    </div>
  )
}
