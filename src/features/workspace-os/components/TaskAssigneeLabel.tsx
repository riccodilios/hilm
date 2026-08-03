import { useTranslation } from 'react-i18next'
import { UserRound, Users } from 'lucide-react'
import type { TaskAssignmentInfo } from '@/features/workspace-os/lib/org-visibility'
import type { WorkspaceTaskAssignee } from '@/features/workspace-os/api'
import { memberInitials } from '@/features/workspace-os/lib/member-display'
import { cn } from '@/lib/utils'

export function TaskAssigneeLabel({
  assignee,
  assignment,
  className,
  compact = false,
}: {
  assignee?: WorkspaceTaskAssignee | null
  assignment?: TaskAssignmentInfo | null
  className?: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const info = assignment ?? null
  const person = info?.assignee ?? assignee ?? null
  const state = info?.state ?? (person ? 'individual' : 'unassigned')

  if (state === 'individual' && person) {
    return (
      <span
        className={cn(
          'inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted',
          className,
        )}
        title={
          info?.team
            ? `${person.display_name} · ${info.team.name}`
            : person.display_name
        }
      >
        {person.avatar_url ? (
          <img
            src={person.avatar_url}
            alt=""
            className="size-4 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[8px] font-medium text-accent">
            {memberInitials(person.display_name)}
          </span>
        )}
        <span className={cn('truncate', compact ? 'max-w-[8rem]' : 'max-w-[12rem]')}>
          {person.display_name}
          {!compact && info?.team ? (
            <span className="text-muted-fg"> · {info.team.name}</span>
          ) : null}
        </span>
      </span>
    )
  }

  if (state === 'team' && (info?.team || info?.department)) {
    const label = info.team?.name
      ? info.team.name
      : info.department
        ? t('workspace.assignedToDepartment', { name: info.department.name })
        : t('workspace.assignedToTeam')
    return (
      <span
        className={cn(
          'inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted',
          className,
        )}
        title={label}
      >
        <Users className="size-3.5 shrink-0 opacity-70" />
        <span className={cn('truncate', compact ? 'max-w-[8rem]' : 'max-w-[12rem]')}>
          {t('workspace.assignedToTeamLabel', { name: label })}
        </span>
      </span>
    )
  }

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-muted', className)}>
      <UserRound className="size-3.5 shrink-0 opacity-70" />
      {t('workspace.unassigned')}
    </span>
  )
}
