import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { KanbanBoard } from '@/features/tasks/KanbanBoard'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'

export function KanbanPage() {
  return (
    <div>
      <PageHeader
        title="Task board"
        description="Move work forward, one column at a time."
        actions={<Button asChild><Link to="/tasks?new=1"><Plus /> New task</Link></Button>}
      />
      <KanbanBoard />
    </div>
  )
}
