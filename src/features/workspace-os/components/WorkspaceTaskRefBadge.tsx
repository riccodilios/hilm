import { Link } from 'react-router-dom'
import { formatWorkspaceTaskRef } from '@/features/workspace-os/lib/task-refs'
import { cn } from '@/lib/utils'

export function WorkspaceTaskRefBadge({
  workspaceId,
  taskKey,
  taskNumber,
  taskId,
  className,
  link = true,
}: {
  workspaceId: string
  taskKey: string
  taskNumber: number
  taskId: string
  className?: string
  link?: boolean
}) {
  const ref = formatWorkspaceTaskRef(taskKey, taskNumber)
  if (!ref) return null
  const classes = cn(
    'font-mono text-[11px] tracking-wide text-muted hover:text-fg',
    className,
  )
  if (!link) return <span className={classes}>{ref}</span>
  return (
    <Link to={`/workspace/${workspaceId}/tasks/${taskId}`} className={classes}>
      {ref}
    </Link>
  )
}
