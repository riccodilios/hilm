import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mic } from 'lucide-react'
import { getMeetingTitle, meetingKeys } from '../api'
import type { MeetingOs } from '../types'

/** "Created from meeting" badge on task detail pages. Hidden if the meeting is gone. */
export function MeetingSourceLink({
  os,
  meetingId,
  href,
}: {
  os: MeetingOs
  meetingId: string
  href: (projectId: string | null) => string
}) {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: [...meetingKeys.detail(os, meetingId), 'title'],
    queryFn: () => getMeetingTitle(os, meetingId),
    staleTime: 60_000,
  })
  if (!data) return null
  return (
    <Link
      to={href(data.projectId)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-subtle bg-surface-2/60 px-3 py-1 text-xs text-muted hover:text-foreground"
    >
      <Mic className="size-3.5 shrink-0" />
      <span className="truncate" dir="auto">
        {t('meetings.createdFrom', { title: data.title })}
      </span>
    </Link>
  )
}
