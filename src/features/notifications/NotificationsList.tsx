import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  listNotifications,
  markNotificationRead,
  notificationsKeys,
} from '@/features/notifications/api'
import { ProjectBadge } from '@/components/ProjectBadge'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/page'

export function NotificationsList({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: notificationsKeys.list(),
    queryFn: listNotifications,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKeys.all }),
    onError: (error: Error) => toast.error(error.message),
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className={compact ? 'h-14' : 'h-20'} />
        <Skeleton className={compact ? 'h-14' : 'h-20'} />
      </div>
    )
  }

  if (!data?.length) {
    return (
      <EmptyState
        title={t('nav.notifications')}
        description={t('notifications.empty')}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/app/settings">{t('nav.settings')}</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className={compact ? 'max-h-[60vh] space-y-2 overflow-y-auto pe-1' : 'space-y-2'}>
      {data.map((item) => {
        const content = (
          <div
            className={`flex items-start gap-3 rounded-xl border border-border-subtle bg-surface/70 transition-colors hover:border-border hover:bg-surface ${
              compact ? 'p-3' : 'p-4'
            }`}
          >
            <Bell className={`mt-0.5 size-4 shrink-0 ${item.read_at ? 'text-muted' : 'text-foreground'}`} />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm ${item.read_at ? 'text-muted' : 'font-medium'}`}>{item.title}</p>
              {item.body ? <p className="mt-1 text-xs text-muted">{item.body}</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                {item.projects ? <ProjectBadge {...item.projects} /> : null}
                <span>{format(new Date(item.created_at), 'MMM d · HH:mm')}</span>
              </div>
            </div>
          </div>
        )
        return item.href ? (
          <Link
            key={item.id}
            to={item.href}
            onClick={() => {
              if (!item.read_at) markRead.mutate(item.id)
            }}
          >
            {content}
          </Link>
        ) : (
          <button
            key={item.id}
            type="button"
            className="block w-full text-start"
            onClick={() => {
              if (!item.read_at) markRead.mutate(item.id)
            }}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
