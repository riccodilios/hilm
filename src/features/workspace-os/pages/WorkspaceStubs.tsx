import { useTranslation } from 'react-i18next'
import { ScaffoldPage } from '@/components/ScaffoldPage'

export function WorkspaceSprintPage() {
  const { t } = useTranslation()
  return <ScaffoldPage title={t('nav.sprint')} description={t('workspace.sprintDesc')} />
}

export function WorkspaceRoadmapPage() {
  const { t } = useTranslation()
  return <ScaffoldPage title={t('nav.roadmap')} description={t('workspace.roadmapDesc')} />
}
