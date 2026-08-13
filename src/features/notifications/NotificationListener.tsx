import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { notificationsKeys } from '@/features/notifications/api'
import { formatNotificationCopy } from '@/features/notifications/format'

const seenKey = 'hilm-notif-seen'

function markSeen(id: string) {
  try {
    const raw = sessionStorage.getItem(seenKey)
    const ids = raw ? (JSON.parse(raw) as string[]) : []
    if (!ids.includes(id)) {
      ids.push(id)
      sessionStorage.setItem(seenKey, JSON.stringify(ids.slice(-40)))
    }
  } catch {
    // ignore
  }
}

function wasSeen(id: string) {
  try {
    const raw = sessionStorage.getItem(seenKey)
    const ids = raw ? (JSON.parse(raw) as string[]) : []
    return ids.includes(id)
  } catch {
    return false
  }
}

function showOsNotification(title: string, body?: string | null, href?: string | null) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, {
      body: body || undefined,
      icon: '/pwa-192.png',
      tag: href || title,
    })
    n.onclick = () => {
      window.focus()
      if (href) window.location.assign(href)
      n.close()
    }
  } catch {
    // Some browsers require service-worker showNotification only
  }
}

/**
 * Surfaces in-app + OS notifications when reminder rows land,
 * even if Web Push subscription failed on this device.
 */
export function NotificationListener() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const qc = useQueryClient()

  useEffect(() => {
    if (!user) return

    let cancelled = false

    async function hydrateUnread() {
      const { data } = await supabase
        .from('notifications')
        .select('id, type, title, body, href, metadata, created_at')
        .eq('user_id', user!.id)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(5)
      if (cancelled || !data?.length) return

      const fresh = data.filter((row) => !wasSeen(row.id))
      if (!fresh.length) return

      for (const row of fresh) markSeen(row.id)
      const latest = fresh[0]
      const copy = formatNotificationCopy(
        {
          type: latest.type,
          title: latest.title,
          body: latest.body,
          metadata: (latest.metadata as Record<string, unknown> | null) ?? null,
        },
        t,
      )
      toast.message(copy.title, {
        description: copy.body ?? undefined,
        action: latest.href
          ? {
              label: t('common.open', { defaultValue: 'Open' }),
              onClick: () => window.location.assign(latest.href!),
            }
          : undefined,
      })
      showOsNotification(copy.title, copy.body, latest.href)
      void qc.invalidateQueries({ queryKey: notificationsKeys.all })
    }

    void hydrateUnread()

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string
            type?: string
            title: string
            body?: string | null
            href?: string | null
            metadata?: Record<string, unknown> | null
          }
          if (!row?.id || wasSeen(row.id)) return
          markSeen(row.id)
          const copy = formatNotificationCopy(
            {
              type: row.type,
              title: row.title,
              body: row.body,
              metadata: row.metadata ?? null,
            },
            t,
          )
          toast.message(copy.title, {
            description: copy.body ?? undefined,
            action: row.href
              ? {
                  label: t('common.open', { defaultValue: 'Open' }),
                  onClick: () => window.location.assign(row.href!),
                }
              : undefined,
          })
          showOsNotification(copy.title, copy.body, row.href)
          void qc.invalidateQueries({ queryKey: notificationsKeys.all })
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [user, qc, t])

  return null
}
