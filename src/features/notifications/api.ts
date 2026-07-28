import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'

export const notificationsKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationsKeys.all, 'list'] as const,
  unreadCount: () => [...notificationsKeys.all, 'unread-count'] as const,
}

export type NotificationRow = {
  id: string
  title: string
  body: string | null
  href: string | null
  read_at: string | null
  created_at: string
  project_id: string | null
  projects: { id: string; name: string; color: string; icon: string | null } | null
}

export async function listNotifications() {
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
    projects: Array.isArray(row.projects) ? (row.projects[0] ?? null) : row.projects,
  })) as NotificationRow[]
}

export async function countUnreadNotifications() {
  const userId = await requireUserId()
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  if (error) throw error
  return count ?? 0
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Keep unsent reminder channels aligned with current user notification prefs. */
export async function syncUnsentReminderChannels() {
  const userId = await requireUserId()
  const { data: settings } = await supabase
    .from('user_settings')
    .select('email_reminders_enabled, push_notifications_enabled')
    .eq('user_id', userId)
    .maybeSingle()

  const channels: Array<'email' | 'push' | 'in_app'> = ['in_app']
  if (settings?.email_reminders_enabled !== false) channels.push('email')
  if (settings?.push_notifications_enabled) channels.push('push')

  const { error } = await supabase
    .from('task_reminders')
    .update({ channels })
    .eq('user_id', userId)
    .eq('notification_sent', false)
  if (error) throw error
}
