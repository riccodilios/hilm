import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { ProjectBadge } from '@/components/ProjectBadge'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/page'

type NotificationRow = {
  id: string
  title: string
  body: string | null
  href: string | null
  read_at: string | null
  created_at: string
  project_id: string | null
  projects: { id: string; name: string; color: string; icon: string | null } | null
}

export const notificationsKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationsKeys.all, 'list'] as const,
}

async function listNotifications() {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, href, read_at, created_at, project_id, projects(id, name, color, icon)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    projects: Array.isArray(row.projects) ? row.projects[0] ?? null : row.projects,
  })) as NotificationRow[]
}

export function NotificationsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: notificationsKeys.list(),
    queryFn: listNotifications,
  })

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKeys.all }),
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div>
      <PageHeader
        title={t('settings.notifications')}
        description={t('settings.notificationsDesc')}
      />
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : !data?.length ? (
        <EmptyState
          title={t('settings.notifications')}
          description={t('settings.notificationsDesc')}
          action={
            <Button asChild variant="secondary">
              <Link to="/app/settings">{t('nav.settings')}</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {data.map((item) => {
            const content = (
              <div className="flex items-start gap-3 rounded-xl border border-border-subtle bg-surface/70 p-4 transition-colors hover:border-border hover:bg-surface">
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
      )}
    </div>
  )
}
