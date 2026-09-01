import { PageHeader } from '@/components/ui/page'
import { EmptyState } from '@/components/ui/page'
import { useTranslation } from 'react-i18next'

/** OS-agnostic placeholder page for features not yet implemented. */
export function ScaffoldPage({
  title,
  description,
}: {
  title: string
  description: string
}) {
  const { t } = useTranslation()
  return (
    <div>
      <PageHeader title={title} description={description} />
      <EmptyState
        title={t('common.comingSoon')}
        description={t('common.comingSoonBody')}
      />
    </div>
  )
}
