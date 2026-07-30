import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Check, ChevronLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getTask, listSubtasks, tasksKeys, updateTask } from '@/features/tasks/api'
import { homeKeys } from '@/features/home/api'
import { activityKeys } from '@/features/activity/api'
import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { useSpeechDictation } from '@/hooks/useSpeechDictation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ProjectBadge } from '@/components/ProjectBadge'
import { VoiceAddButton } from '@/components/VoiceAddButton'
import { EmptyState, Skeleton } from '@/components/ui/page'
import { REMINDER_OPTIONS, type ReminderType } from '@/features/tasks/reminders'
import { PRIORITIES, TASK_STATUSES } from '@/types/domain'
import type { Priority, TaskStatus } from '@/types/domain'

function speechLangFromI18n(lng: string) {
  return lng.startsWith('ar') ? 'ar-SA' : 'en-US'
}

function appendVoiceText(current: string, addition: string) {
  const next = addition.trim()
  if (!next) return current
  const base = current.trimEnd()
  if (!base) return next
  const needsSpace = !/[\s\n]$/.test(base)
  return `${base}${needsSpace ? ' ' : ''}${next}`
}

export function TaskDetailPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const qc = useQueryClient()
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [description, setDescription] = useState('')
  const { data: task, isLoading } = useQuery({
    queryKey: tasksKeys.detail(id ?? ''),
    queryFn: () => getTask(id!),
    enabled: Boolean(id),
  })
  const { data: subtasks } = useQuery({
    queryKey: [...tasksKeys.detail(id ?? ''), 'subtasks'],
    queryFn: () => listSubtasks(id!),
    enabled: Boolean(id),
  })

  useEffect(() => {
    if (task) setDescription(task.description ?? '')
  }, [task?.id, task?.description])

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateTask>[1]) => updateTask(id!, patch),
    onSuccess: () => {
      void Promise.all([
        qc.invalidateQueries({ queryKey: tasksKeys.all }),
        qc.invalidateQueries({ queryKey: homeKeys.all }),
        qc.invalidateQueries({ queryKey: activityKeys.all }),
      ])
      toast.success(t('tasks.updated'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const persistDescription = useCallback(
    (value: string) => {
      if (!task) return
      if (value === (task.description ?? '')) return
      save.mutate({ description: value })
    },
    [save, task],
  )

  const dictation = useSpeechDictation({
    lang: speechLangFromI18n(i18n.language),
    onFinal: (transcript) => {
      setDescription((prev) => {
        const next = appendVoiceText(prev, transcript)
        persistDescription(next)
        return next
      })
    },
    onError: (code) => {
      if (code === 'unsupported') toast.error(t('tasks.voiceUnsupported'))
      else if (code === 'not-allowed') toast.error(t('tasks.voiceDenied'))
      else toast.error(t('tasks.voiceFailed'))
    },
  })

  const addSubtask = useMutation({
    mutationFn: async () => {
      const userId = await requireUserId()
      const { error } = await supabase.from('subtasks').insert({
        user_id: userId,
        task_id: id!,
        title: subtaskTitle,
        position: subtasks?.length ?? 0,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...tasksKeys.detail(id ?? ''), 'subtasks'] })
      setSubtaskTitle('')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (isLoading) return <Skeleton className="h-96" />
  if (!task) {
    return (
      <EmptyState
        title={t('tasks.notFound')}
        action={
          <Button asChild>
            <Link to="/personal/tasks">{t('tasks.back')}</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link to="/personal/tasks">
          <ChevronLeft /> {t('tasks.title')}
        </Link>
      </Button>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-medium tracking-tight">{t('tasks.details')}</h1>
          {task.projects ? <ProjectBadge {...task.projects} size="md" /> : null}
        </div>
        <Button
          disabled={task.status === 'done' || save.isPending}
          onClick={() => save.mutate({ status: 'done' })}
        >
          <Check /> {task.status === 'done' ? t('tasks.completed') : t('tasks.complete')}
        </Button>
      </div>
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div className="space-y-2">
              <Label htmlFor="title">{t('projects.name')}</Label>
              <Input
                id="title"
                defaultValue={task.title}
                onBlur={(event) => {
                  if (event.target.value.trim() && event.target.value !== task.title) {
                    save.mutate({ title: event.target.value.trim() })
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="description">{t('projects.desc')}</Label>
                <VoiceAddButton
                  supported={dictation.supported}
                  listening={dictation.listening}
                  onToggle={dictation.toggle}
                />
              </div>
              <Textarea
                id="description"
                value={description}
                rows={7}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => persistDescription(description)}
                placeholder={t('tasks.descriptionPlaceholder')}
              />
              {dictation.listening || dictation.interim ? (
                <p className="text-xs text-muted">
                  {dictation.interim
                    ? `${t('tasks.voiceHearing')}: ${dictation.interim}`
                    : t('tasks.voiceHint')}
                </p>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="status">{t('tasks.status')}</Label>
                <select
                  id="status"
                  value={task.status}
                  onChange={(event) => save.mutate({ status: event.target.value as TaskStatus })}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                >
                  {TASK_STATUSES.filter((status) => status !== 'archived').map((status) => (
                    <option key={status} value={status}>
                      {t(`status.${status}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="priority">{t('tasks.priority')}</Label>
                <select
                  id="priority"
                  value={task.priority}
                  onChange={(event) => save.mutate({ priority: event.target.value as Priority })}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {t(`priority.${priority}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="due-date">{t('tasks.due')}</Label>
                <Input
                  id="due-date"
                  type="date"
                  defaultValue={task.due_date ?? task.due_at?.slice(0, 10) ?? ''}
                  onBlur={(event) => save.mutate({ due_date: event.target.value || null })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminder-type">{t('tasks.reminder')}</Label>
                <select
                  id="reminder-type"
                  value={(task.reminder_type as ReminderType | null) ?? '1h'}
                  onChange={(event) =>
                    save.mutate({ reminderType: event.target.value as ReminderType })
                  }
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                >
                  {REMINDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
              {(task.reminder_type as ReminderType | null) === 'custom' ? (
                <div className="space-y-2 sm:col-span-3">
                  <Label htmlFor="custom-reminder">{t('reminders.custom')}</Label>
                  <Input
                    id="custom-reminder"
                    type="datetime-local"
                    defaultValue={
                      task.reminder_datetime ? task.reminder_datetime.slice(0, 16) : ''
                    }
                    onBlur={(event) => {
                      const value = event.target.value
                      save.mutate({
                        reminderType: 'custom',
                        customReminderAt: value ? new Date(value).toISOString() : null,
                        reminder_datetime: value ? new Date(value).toISOString() : null,
                      })
                    }}
                  />
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('tasks.subtasks')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {subtasks?.map((subtask) => (
                <div
                  key={subtask.id}
                  className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm"
                >
                  <span
                    className={`size-2 rounded-full ${subtask.done ? 'bg-success' : 'bg-muted'}`}
                  />
                  {subtask.title}
                </div>
              ))}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (subtaskTitle.trim()) addSubtask.mutate()
              }}
            >
              <Input
                value={subtaskTitle}
                onChange={(event) => setSubtaskTitle(event.target.value)}
                placeholder={t('tasks.addSubtask')}
              />
              <Button type="submit" size="icon" disabled={addSubtask.isPending}>
                <Plus />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
