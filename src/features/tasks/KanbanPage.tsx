import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { KanbanBoard } from '@/features/tasks/KanbanBoard'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'

export function KanbanPage() {
  const { t } = useTranslation()
  return (
    <div>
      <PageHeader
        title={t('tasks.kanbanTitle')}
        description={t('tasks.emptyBoardBody')}
        actions={<Button asChild><Link to="/personal/tasks?new=1"><Plus /> {t('tasks.new')}</Link></Button>}
      />
      <KanbanBoard />
    </div>
  )
}
