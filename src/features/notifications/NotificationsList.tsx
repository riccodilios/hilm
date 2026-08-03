import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  clearReadNotifications,
  listNotifications,
  markAllNotificationsRead,
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

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: notificationsKeys.list() }),
      qc.invalidateQueries({ queryKey: notificationsKeys.unreadCount() }),
    ])
  }

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async () => {
      await invalidate()
      toast.success(t('notifications.markedAllRead'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const clearRead = useMutation({
    mutationFn: clearReadNotifications,
    onSuccess: async () => {
      await invalidate()
      toast.success(t('notifications.clearedRead'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const unread = (data ?? []).filter((item) => !item.read_at).length
  const readCount = (data ?? []).filter((item) => item.read_at).length

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className={compact ? 'h-14' : 'h-20'} />
        <Skeleton className={compact ? 'h-14' : 'h-20'} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {(data?.length ?? 0) > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!unread || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {t('notifications.markAllRead')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!readCount || clearRead.isPending}
            onClick={() => {
              if (window.confirm(t('notifications.clearReadConfirm'))) clearRead.mutate()
            }}
          >
            {t('notifications.clearRead')}
          </Button>
        </div>
      ) : null}

      {!data?.length ? (
        <EmptyState
          title={t('nav.notifications')}
          description={t('notifications.empty')}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/personal/settings">{t('nav.settings')}</Link>
            </Button>
          }
        />
      ) : (
        <div className={compact ? 'max-h-[min(50vh,360px)] space-y-2 overflow-y-auto overflow-x-hidden pe-1' : 'space-y-2'}>
          <AnimatePresence initial={false}>
            {data.map((item) => {
              const content = (
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`flex w-full min-w-0 items-start gap-3 rounded-xl border border-border-subtle bg-surface/70 transition-colors hover:border-border hover:bg-surface ${
                    compact ? 'p-3' : 'p-4'
                  }`}
                >
                  <Bell
                    className={`mt-0.5 size-4 shrink-0 ${item.read_at ? 'text-muted' : 'text-foreground'}`}
                  />
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <p className={`truncate text-sm ${item.read_at ? 'text-muted' : 'font-medium'}`}>
                      {item.title}
                    </p>
                    {item.body ? (
                      <p className="mt-1 break-words text-xs text-muted whitespace-pre-wrap">{item.body}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {item.projects ? <ProjectBadge {...item.projects} /> : null}
                      <span className="shrink-0">{format(new Date(item.created_at), 'MMM d · HH:mm')}</span>
                    </div>
                  </div>
                </motion.div>
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
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
