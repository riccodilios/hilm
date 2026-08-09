import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Plus,
} from 'lucide-react'
import { toast } from 'sonner'
import { listTasks, tasksKeys, updateTask, createTask } from '@/features/tasks/api'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { getDashboardData, homeKeys } from '@/features/home/api'
import { MissionCalendar } from '@/features/mission-control/MissionCalendar'
import { MissionTimeline } from '@/features/mission-control/MissionTimeline'
import { MissionOverview } from '@/features/mission-control/MissionOverview'
import { MissionHorizon } from '@/features/mission-control/MissionHorizon'
import {
  schedulePatchForDrop,
  suggestBestSlot,
  type CalendarView,
  type HorizonZoom,
} from '@/features/mission-control/lib/schedule'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/page'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { addLocalDays, taskDueDateKey, todayLocalISO, toLocalDateKey } from '@/lib/dates'

type MobilePane = 'calendar' | 'timeline' | 'overview'

export function MissionControlPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const dateLocale = i18n.language.startsWith('ar') ? ar : enUS

  const [view, setView] = useState<CalendarView>('month')
  const [horizonZoom, setHorizonZoom] = useState<HorizonZoom>('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState(todayLocalISO())
  const [projectFilter, setProjectFilter] = useState<string | 'all'>('all')
  const [mobilePane, setMobilePane] = useState<MobilePane>('timeline')
  const [slotCreate, setSlotCreate] = useState<{ dayKey: string; hour: number } | null>(null)
  const [slotTitle, setSlotTitle] = useState('')

  const tasksQuery = useQuery({ queryKey: tasksKeys.list(), queryFn: () => listTasks() })
  const projectsQuery = useQuery({ queryKey: projectsKeys.list(), queryFn: listProjects })
  const dashQuery = useQuery({ queryKey: homeKeys.dashboard(), queryFn: getDashboardData })

  const tasks = tasksQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const insights = dashQuery.data?.projects ?? []
  const bootstrapping =
    (tasksQuery.isLoading && !tasksQuery.data) ||
    (projectsQuery.isLoading && !projectsQuery.data)

  const focus = useMemo(() => {
    const open = tasks.filter(
      (task) =>
        task.status !== 'done' &&
        task.status !== 'archived' &&
        (projectFilter === 'all' || task.project_id === projectFilter),
    )
    const today = open.filter((task) => taskDueDateKey(task) === selectedDay)
    return (
      today.find((task) => task.status === 'in_progress') ??
      today.find((task) => task.priority === 'urgent' || task.priority === 'high') ??
      today[0] ??
      open[0] ??
      null
    )
  }, [tasks, selectedDay, projectFilter])

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: tasksKeys.all }),
      qc.invalidateQueries({ queryKey: homeKeys.all }),
      qc.invalidateQueries({ queryKey: projectsKeys.all }),
    ])
  }

  const reschedule = useMutation({
    mutationFn: async (input: {
      taskId: string
      dayKey: string
      hour?: number
      durationHours?: number
    }) => {
      const hour = input.hour ?? 9
      const patch = schedulePatchForDrop(input.dayKey, hour, input.durationHours)
      return updateTask(input.taskId, {
        due_date: patch.due_date,
        due_at: patch.due_at,
        estimated_hours: patch.estimated_hours,
      })
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: tasksKeys.all })
      const hour = input.hour ?? 9
      const patch = schedulePatchForDrop(input.dayKey, hour, input.durationHours)
      const previousLists = qc.getQueriesData({ queryKey: [...tasksKeys.all, 'list'] })
      qc.setQueriesData({ queryKey: [...tasksKeys.all, 'list'] }, (old) => {
        if (!Array.isArray(old)) return old
        return old.map((task: (typeof tasks)[number]) =>
          task.id === input.taskId
            ? {
                ...task,
                due_date: patch.due_date,
                due_at: patch.due_at,
                estimated_hours: patch.estimated_hours,
              }
            : task,
        )
      })
      return { previousLists }
    },
    onError: (error: Error, _input, ctx) => {
      ctx?.previousLists?.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.error(error.message)
    },
    onSuccess: async (_data, input) => {
      await invalidate()
      // Duration resize fires many micro-updates; toast only for day/time moves.
      if (input.durationHours == null) toast.success(t('mission.moved'))
    },
  })

  const slotCreateMutation = useMutation({
    mutationFn: async () => {
      if (!slotCreate) throw new Error('No slot')
      const projectId = projectFilter !== 'all' ? projectFilter : projects[0]?.id
      if (!projectId) throw new Error(t('tasks.projectRequired'))
      const patch = schedulePatchForDrop(slotCreate.dayKey, slotCreate.hour, 1)
      return createTask({
        title: slotTitle.trim() || t('mission.newBlock'),
        projectId,
        dueDate: patch.due_date,
        dueAt: patch.due_at,
        status: 'todo',
        priority: 'medium',
        estimatedHours: 1,
      })
    },
    onSuccess: async (task) => {
      setSlotCreate(null)
      setSlotTitle('')
      await invalidate()
      navigate(`/personal/tasks/${task.id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const complete = useMutation({
    mutationFn: (taskId: string) => updateTask(taskId, { status: 'done' }),
    onSuccess: async () => {
      await invalidate()
      toast.success(t('mission.completedToast'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const balance = useMutation({
    mutationFn: async () => {
      const openToday = tasks.filter(
        (task) =>
          taskDueDateKey(task) === selectedDay &&
          task.status !== 'done' &&
          task.status !== 'archived' &&
          (projectFilter === 'all' || task.project_id === projectFilter),
      )
      const low = openToday
        .filter((task) => task.priority === 'low' || task.priority === 'none')
        .slice(0, 3)
      const tomorrow = addLocalDays(selectedDay, 1)
      for (const [index, task] of low.entries()) {
        await updateTask(task.id, schedulePatchForDrop(tomorrow, 9 + index))
      }
      return low.length
    },
    onSuccess: async (count) => {
      await invalidate()
      toast.success(
        count
          ? t('mission.balanced', { count })
          : t('mission.balancedNone'),
      )
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const quickCreate = useMutation({
    mutationFn: async () => {
      const projectId = projectFilter !== 'all' ? projectFilter : projects[0]?.id
      if (!projectId) throw new Error(t('tasks.projectRequired'))
      const hour = suggestBestSlot(tasks, selectedDay, 1)
      const patch = schedulePatchForDrop(selectedDay, hour)
      return createTask({
        title: t('mission.newBlock'),
        projectId,
        dueDate: patch.due_date,
        dueAt: patch.due_at,
        status: 'todo',
        priority: 'medium',
        estimatedHours: 1,
      })
    },
    onSuccess: async (task) => {
      await invalidate()
      navigate(`/personal/tasks/${task.id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function shiftAnchor(delta: number) {
    setAnchor((current) => {
      const next = addDays(current, view === 'month' ? delta * 30 : view === 'week' ? delta * 7 : delta)
      if (view === 'day') setSelectedDay(toLocalDateKey(next)!)
      return next
    })
  }

  const title = format(anchor, view === 'day' ? 'EEEE, MMM d' : view === 'week' ? "'Week of' MMM d" : 'MMMM yyyy', {
    locale: dateLocale,
  })

  if (bootstrapping) {
    return (
      <div className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-8 w-full max-w-xl" />
        <Skeleton className="h-20 w-full" />
        <div className="grid min-h-[70dvh] gap-4 lg:grid-cols-3">
          <Skeleton className="min-h-[420px]" />
          <Skeleton className="min-h-[420px]" />
          <Skeleton className="min-h-[420px]" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-4">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-accent">
            <Crosshair className="size-4" />
            <p className="text-xs uppercase tracking-[0.16em]">{t('mission.eyebrow')}</p>
          </div>
          <h1 className="mt-1 text-2xl font-medium tracking-tight sm:text-3xl">{t('mission.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('mission.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => quickCreate.mutate()} disabled={quickCreate.isPending}>
            <Plus className="size-4" /> {t('mission.addBlock')}
          </Button>
          <div className="flex rounded-xl border border-border bg-surface/60 p-1">
            {(['month', 'week', 'day'] as CalendarView[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={cn(
                  'rounded-lg px-2.5 py-1.5 text-xs capitalize',
                  view === item ? 'bg-surface-2 text-foreground' : 'text-muted hover:text-foreground',
                )}
              >
                {t(`mission.view.${item}`)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="secondary" onClick={() => shiftAnchor(-1)} aria-label={t('mission.prev')}>
          <ChevronLeft className="size-4" />
        </Button>
        <button
          type="button"
          className="min-w-0 rounded-xl border border-border-subtle bg-surface/50 px-3 py-2 text-sm font-medium"
          onClick={() => {
            const today = new Date()
            setAnchor(today)
            setSelectedDay(todayLocalISO())
          }}
        >
          {title}
        </button>
        <Button size="icon" variant="secondary" onClick={() => shiftAnchor(1)} aria-label={t('mission.next')}>
          <ChevronRight className="size-4" />
        </Button>

        <div className="ms-auto flex max-w-full gap-1 overflow-x-auto pb-1">
          <FilterChip active={projectFilter === 'all'} onClick={() => setProjectFilter('all')}>
            {t('mission.allProjects')}
          </FilterChip>
          {projects.map((project) => (
            <FilterChip
              key={project.id}
              active={projectFilter === project.id}
              color={project.color}
              onClick={() => setProjectFilter(project.id)}
            >
              {project.name}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-border-subtle bg-surface/50 p-1 lg:hidden">
        {([
          ['calendar', t('mission.calendar')],
          ['timeline', t('mission.timeline')],
          ['overview', t('mission.overview')],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMobilePane(id)}
            className={cn(
              'flex-1 rounded-lg px-2 py-2 text-xs',
              mobilePane === id ? 'bg-surface-2 text-foreground' : 'text-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <MissionHorizon
        zoom={horizonZoom}
        onZoomChange={setHorizonZoom}
        selectedDay={selectedDay}
        tasks={tasks}
        projectFilter={projectFilter}
        focus={focus}
        onSelectDay={(day) => {
          setSelectedDay(day)
          setAnchor(parseISO(day))
          setMobilePane('timeline')
        }}
      />

      <div className="grid min-h-[70dvh] gap-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(320px,1.15fr)_minmax(260px,0.85fr)]">
        <section
          className={cn(
            'flex min-h-[420px] flex-col rounded-2xl border border-border-subtle bg-surface/30 p-3 sm:p-4',
            mobilePane === 'calendar' ? 'flex' : 'hidden lg:flex',
          )}
        >
          <MissionCalendar
            view={view}
            anchor={anchor}
            selectedDay={selectedDay}
            tasks={tasks}
            projectFilter={projectFilter}
            onSelectDay={(day) => {
              setSelectedDay(day)
              setAnchor(parseISO(day))
              setMobilePane('timeline')
            }}
            onDropTask={(taskId, dayKey) => reschedule.mutate({ taskId, dayKey, hour: 9 })}
            onOpenTask={(task) => navigate(`/personal/tasks/${task.id}`)}
          />
        </section>

        <section
          className={cn(
            'flex min-h-0 min-h-[420px] max-h-[calc(100dvh-12rem)] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface/30 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4',
            mobilePane === 'timeline' ? 'flex' : 'hidden lg:flex',
          )}
        >
          <MissionTimeline
            dayKey={selectedDay}
            tasks={tasks}
            projectFilter={projectFilter}
            onOpenTask={(task) => navigate(`/personal/tasks/${task.id}`)}
            onReschedule={async (taskId, dayKey, hour, durationHours) => {
              await reschedule.mutateAsync({ taskId, dayKey, hour, durationHours })
            }}
            onComplete={(taskId) => complete.mutate(taskId)}
            onEmptySlotClick={(dayKey, hour) => {
              setSelectedDay(dayKey)
              setSlotCreate({ dayKey, hour })
              setSlotTitle('')
            }}
          />
        </section>

        <section
          className={cn(
            'flex min-h-0 min-h-[420px] max-h-[calc(100dvh-12rem)] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface/30 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4',
            mobilePane === 'overview' ? 'flex' : 'hidden lg:flex',
          )}
        >
          <MissionOverview
            dayKey={selectedDay}
            tasks={tasks}
            projects={insights}
            projectFilter={projectFilter}
            focus={focus}
            onSelectDay={(day) => {
              setSelectedDay(day)
              setAnchor(parseISO(day))
              setMobilePane('timeline')
            }}
            onApplyBalance={() => balance.mutate()}
          />
        </section>
      </div>

      <Dialog open={Boolean(slotCreate)} onOpenChange={(open) => !open && setSlotCreate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tasks.new')}</DialogTitle>
            <DialogDescription>
              {slotCreate
                ? `${slotCreate.dayKey} · ${String(Math.floor(slotCreate.hour)).padStart(2, '0')}:${String(
                    Math.round((slotCreate.hour % 1) * 60),
                  ).padStart(2, '0')}`
                : null}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={slotTitle}
            onChange={(e) => setSlotTitle(e.target.value)}
            placeholder={t('mission.newBlock')}
            autoFocus
          />
          <Button
            disabled={slotCreateMutation.isPending}
            onClick={() => slotCreateMutation.mutate()}
          >
            {t('common.create')}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FilterChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean
  color?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-accent/40 bg-accent/10 text-foreground'
          : 'border-border-subtle bg-surface/40 text-muted hover:text-foreground',
      )}
    >
      {color ? <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} /> : null}
      {children}
    </button>
  )
}
