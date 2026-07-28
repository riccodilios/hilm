import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'
import { activityKeys, listActivity } from '@/features/activity/api'
import { Badge } from '@/components/ui/badge'
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/page'
import { formatRelative } from '@/lib/utils'

export function ActivityPage() {
  const { t } = useTranslation()
  const { data: events, isLoading } = useQuery({ queryKey: activityKeys.feed(100), queryFn: () => listActivity(100) })
  return <div className="max-w-3xl"><PageHeader title={t('activity.title')} description={t('activity.description')} />{isLoading ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : !events?.length ? <EmptyState title={t('activity.empty')} /> : <div className="relative space-y-0 before:absolute before:bottom-5 before:left-4 before:top-5 before:w-px before:bg-border-subtle">{events.map((event) => <article key={event.id} className="relative flex gap-4 py-3"><div className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted"><Activity className="size-3.5" /></div><div className="min-w-0 flex-1 rounded-xl border border-border-subtle bg-surface/70 p-4"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium">{event.summary}</p><time className="shrink-0 text-xs text-muted">{formatRelative(event.created_at)}</time></div><div className="mt-2 flex gap-2"><Badge className="bg-surface-3 text-muted">{event.entity_type.replace('_', ' ')}</Badge><Badge className="bg-surface-3 text-muted">{event.action}</Badge></div></div></article>)}</div>}</div>
}
