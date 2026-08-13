import type { TFunction } from 'i18next'

export type NotificationDisplayInput = {
  type?: string | null
  title: string
  body?: string | null
  metadata?: Record<string, unknown> | null
}

function metaString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/**
 * Localize known notification types from metadata.
 * Falls back to stored title/body for legacy or unknown rows.
 */
export function formatNotificationCopy(
  item: NotificationDisplayInput,
  t: TFunction,
): { title: string; body: string | null } {
  const metadata = item.metadata ?? null
  const type = item.type ?? ''

  if (type === 'workspace.task.assigned') {
    const task = metaString(metadata, 'task_ref') || metaString(metadata, 'task_title')
    return {
      title: t('notifications.types.taskAssigned'),
      body: task
        ? t('notifications.types.taskAssignedBody', { task })
        : (item.body ?? null),
    }
  }

  if (type === 'workspace.task.lead') {
    const task = metaString(metadata, 'task_ref') || metaString(metadata, 'task_title')
    return {
      title: t('notifications.types.taskLead'),
      body: task
        ? t('notifications.types.taskLeadBody', { task })
        : (item.body ?? null),
    }
  }

  if (type === 'workspace.task.mention') {
    const author = metaString(metadata, 'author_name') || t('common.member', { defaultValue: 'Member' })
    const task = metaString(metadata, 'task_ref') || metaString(metadata, 'task_title')
    const snippet = metaString(metadata, 'snippet')
    return {
      title: t('notifications.types.mention'),
      body: t('notifications.types.mentionBody', {
        author,
        task: task || '—',
        snippet: snippet || '',
      }),
    }
  }

  if (type === 'task.reminder' || type === 'reminder' || type === 'task_reminder') {
    const task = metaString(metadata, 'task_title') || item.title
    const due = metaString(metadata, 'due_label')
    return {
      title: t('notifications.types.reminder', { task }),
      body: due
        ? t('notifications.types.reminderBody', { due })
        : (item.body ?? null),
    }
  }

  return { title: item.title, body: item.body ?? null }
}
