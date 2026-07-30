import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useLongPress } from '@/hooks/useLongPress'
import { PriorityBadge, StatusBadge } from '@/components/ui/badge'
import { ProjectBadge } from '@/components/ProjectBadge'
import { cn } from '@/lib/utils'
import type { TaskWithProject } from '@/features/tasks/reminders'

export function TaskListItem({
  task,
  onOpenMenu,
  className,
}: {
  task: TaskWithProject
  onOpenMenu: (task: TaskWithProject) => void
  className?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const longPressed = useRef(false)

  const longPress = useLongPress(() => {
    longPressed.current = true
    onOpenMenu(task)
  })

  return (
    <div
      role="link"
      tabIndex={0}
      className={cn(
        'flex cursor-pointer touch-manipulation select-none items-center justify-between gap-4 rounded-xl border border-border-subtle bg-surface/70 p-4 transition-colors hover:border-border hover:bg-surface',
        task.status === 'done' && 'opacity-55 grayscale-[0.35]',
        className,
      )}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false
          return
        }
        navigate(`/personal/tasks/${task.id}`)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(`/personal/tasks/${task.id}`)
        }
      }}
      {...longPress}
    >
      <div className="min-w-0">
        <p className={cn('truncate font-medium', task.status === 'done' && 'text-muted line-through')}>
          {task.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          {task.projects ? <ProjectBadge {...task.projects} /> : null}
          <span>
            {task.due_at
              ? `${t('tasks.due')} ${new Date(task.due_at).toLocaleDateString()}`
              : t('home.noDueDate')}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} />
      </div>
    </div>
  )
}
