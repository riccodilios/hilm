import { useTranslation } from 'react-i18next'
import { UserRound } from 'lucide-react'
import type { WorkspaceTaskAssignee } from '@/features/workspace-os/api'
import { memberInitials } from '@/features/workspace-os/lib/member-display'
import { cn } from '@/lib/utils'

export function TaskAssigneeLabel({
  assignee,
  className,
  compact = false,
}: {
  assignee?: WorkspaceTaskAssignee | null
  className?: string
  compact?: boolean
}) {
  const { t } = useTranslation()

  if (!assignee) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-muted', className)}>
        <UserRound className="size-3.5 shrink-0 opacity-70" />
        {t('workspace.unassigned')}
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted',
        className,
      )}
      title={assignee.display_name}
    >
      {assignee.avatar_url ? (
        <img
          src={assignee.avatar_url}
          alt=""
          className="size-4 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[8px] font-medium text-accent">
          {memberInitials(assignee.display_name)}
        </span>
      )}
      <span className={cn('truncate', compact ? 'max-w-[7rem]' : 'max-w-[10rem]')}>
        {assignee.display_name}
      </span>
    </span>
  )
}
