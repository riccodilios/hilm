import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink, FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getProject, projectsKeys, updateProject } from '@/features/projects/api'
import {
  labelKeys,
  listLabels,
  listProjectLabels,
  setProjectLabels,
} from '@/features/projects/labels-api'
import { ProjectLabelPicker } from '@/components/labels/ProjectLabelPicker'
import { homeKeys } from '@/features/home/api'
import { ProjectIcon, ProjectIconPicker } from '@/features/projects/icons'
import { listTasks, tasksKeys } from '@/features/tasks/api'
import { TaskListItem } from '@/features/tasks/TaskListItem'
import { TaskActionsDialog } from '@/features/tasks/TaskActionsDialog'
import { KanbanBoard } from '@/features/tasks/KanbanBoard'
import type { TaskWithProject } from '@/features/tasks/reminders'
import { activityKeys, listActivity } from '@/features/activity/api'
import { createNote, listNotes, notesKeys } from '@/features/notes/api'
import { createRoadmapItem, listRoadmap, roadmapKeys } from '@/features/roadmap/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HealthBadge, PriorityBadge } from '@/components/ui/badge'
import { EmptyState, Skeleton } from '@/components/ui/page'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatRelative } from '@/lib/utils'
import { PRIORITIES, PROJECT_COLORS, ROADMAP_HORIZONS } from '@/types/domain'
import type { Priority, ProjectStatus, RoadmapHorizon } from '@/types/domain'

const allTabs = [
  'overview',
  'tasks',
  'kanban',
  'roadmap',
  'notes',
  'activity',
  'ai',
  'settings',
  'ideas',
  'meetings',
  'releases',
  'files',
  'documentation',
] as const
type Tab = (typeof allTabs)[number]

export function ProjectDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [menuTask, setMenuTask] = useState<TaskWithProject | null>(null)
  const [roadmapTitle, setRoadmapTitle] = useState('')
  const [roadmapHorizon, setRoadmapHorizon] = useState<RoadmapHorizon>('next')
  const [settings, setSettings] = useState<{
    name: string
    description: string
    color: string
    icon: string
    status: ProjectStatus
    priority: Priority
  }>({
    name: '',
    description: '',
    color: PROJECT_COLORS[0],
    icon: 'folder',
    status: 'active',
    priority: 'medium',
  })
  const [labelIds, setLabelIds] = useState<string[]>([])

  const { data: project, isLoading } = useQuery({
    queryKey: projectsKeys.detail(id ?? ''),
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
  })
  const { data: tasks } = useQuery({
    queryKey: tasksKeys.byProject(id ?? ''),
    queryFn: () => listTasks({ projectId: id! }),
    enabled: Boolean(id),
  })
  const { data: activity } = useQuery({
    queryKey: activityKeys.byProject(id ?? ''),
    queryFn: () => listActivity(50, id),
    enabled: Boolean(id),
  })
  const { data: roadmap } = useQuery({
    queryKey: roadmapKeys.byProject(id ?? ''),
    queryFn: () => listRoadmap(id!),
    enabled: Boolean(id),
  })
  const { data: notes } = useQuery({
    queryKey: notesKeys.list(id),
    queryFn: () => listNotes(id),
    enabled: Boolean(id),
  })
  const labelsQuery = useQuery({
    queryKey: labelKeys.list(),
    queryFn: listLabels,
  })
  const projectLabelsQuery = useQuery({
    queryKey: labelKeys.project(id ?? ''),
    queryFn: () => listProjectLabels(id!),
    enabled: Boolean(id),
  })

  useEffect(() => {
    if (project) {
      setSettings({
        name: project.name,
        description: project.description ?? '',
        color: project.color,
        icon: project.icon ?? 'folder',
        status: project.status,
        priority: project.priority,
      })
    }
  }, [project])

  useEffect(() => {
    if (projectLabelsQuery.data) {
      setLabelIds(projectLabelsQuery.data.map((label) => label.id))
    }
  }, [projectLabelsQuery.data])

  const invalidateProject = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: projectsKeys.all }),
      qc.invalidateQueries({ queryKey: tasksKeys.all }),
      qc.invalidateQueries({ queryKey: activityKeys.all }),
      qc.invalidateQueries({ queryKey: notesKeys.all }),
      qc.invalidateQueries({ queryKey: roadmapKeys.all }),
      qc.invalidateQueries({ queryKey: homeKeys.all }),
      qc.invalidateQueries({ queryKey: labelKeys.all }),
    ])

  const save = useMutation({
    mutationFn: async () => {
      await updateProject(id!, {
        name: settings.name.trim(),
        description: settings.description,
        color: settings.color,
        icon: settings.icon,
        status: settings.status,
        priority: settings.priority,
      })
      await setProjectLabels(id!, labelIds)
    },
    onSuccess: async () => {
      await invalidateProject()
      toast.success(t('projects.settingsSaved'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const saveLabels = useMutation({
    mutationFn: (ids: string[]) => setProjectLabels(id!, ids),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: labelKeys.all })
      toast.success('Labels updated')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function onLabelsChange(ids: string[]) {
    setLabelIds(ids)
    saveLabels.mutate(ids)
  }

  const addRoadmap = useMutation({
    mutationFn: () =>
      createRoadmapItem({ projectId: id!, title: roadmapTitle.trim(), horizon: roadmapHorizon }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: roadmapKeys.all })
      setRoadmapTitle('')
      toast.success('Roadmap item added')
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const addNote = useMutation({
    mutationFn: () => createNote({ title: 'Untitled note', projectId: id }),
    onSuccess: async (note) => {
      await qc.invalidateQueries({ queryKey: notesKeys.all })
      window.location.assign(`/personal/notes/${note.id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const tabLabels: Record<Tab, string> = {
    overview: t('projects.overview'),
    tasks: t('projects.tasks'),
    kanban: t('projects.kanban'),
    roadmap: t('projects.roadmap'),
    notes: t('projects.notes'),
    activity: t('projects.activity'),
    ai: t('projects.ai'),
    settings: t('projects.settings'),
    ideas: t('projects.ideas'),
    meetings: t('projects.meetings'),
    releases: t('projects.releases'),
    files: t('projects.files'),
    documentation: t('projects.documentation'),
  }

  if (isLoading) return <Skeleton className="h-[32rem]" />
  if (!project) {
    return (
      <EmptyState
        title={t('projects.notFound')}
        action={
          <Button asChild>
            <Link to="/personal/projects">{t('projects.back')}</Link>
          </Button>
        }
      />
    )
  }

  const completed = tasks?.filter((task) => task.status === 'done').length ?? 0

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex size-12 items-center justify-center rounded-2xl text-background"
            style={{ backgroundColor: project.color }}
          >
            <ProjectIcon icon={project.icon} size={22} />
          </span>
          <div>
            <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">{project.name}</h1>
            <p className="mt-1 text-sm text-muted">{project.status}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <HealthBadge health={project.health} />
          <PriorityBadge priority={project.priority} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto min-w-max flex-wrap justify-start">
            {allTabs.map((item) => (
              <TabsTrigger key={item} value={item}>
                {tabLabels[item]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>About this project</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-6 text-muted">
                  {project.description || 'No description yet.'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-medium">{project.completion_pct}%</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${project.completion_pct}%` }}
                  />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Task stats</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-2xl font-medium">{tasks?.length ?? 0}</p>
                  <p className="text-muted">Total tasks</p>
                </div>
                <div>
                  <p className="text-2xl font-medium">{completed}</p>
                  <p className="text-muted">Completed</p>
                </div>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Project health</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <HealthBadge health={project.health} />
                  <p className="text-sm text-muted">
                    {project.health_explanation || 'No health details recorded.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tasks">
          <div className="space-y-2">
            {tasks?.length ? (
              tasks.map((task) => (
                <TaskListItem key={task.id} task={task} onOpenMenu={setMenuTask} />
              ))
            ) : (
              <EmptyState
                title="No tasks yet"
                description="Create tasks from the Tasks page to track project work."
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="kanban">
          <KanbanBoard projectId={id} />
        </TabsContent>

        <TabsContent value="roadmap">
          <div className="mb-5 rounded-2xl border border-border-subtle bg-surface/70 p-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault()
                if (roadmapTitle.trim()) addRoadmap.mutate()
              }}
            >
              <Input
                value={roadmapTitle}
                onChange={(event) => setRoadmapTitle(event.target.value)}
                placeholder="Add roadmap item"
              />
              <select
                value={roadmapHorizon}
                onChange={(event) => setRoadmapHorizon(event.target.value as RoadmapHorizon)}
                className="h-10 rounded-lg border border-border bg-surface px-3 text-sm"
              >
                {ROADMAP_HORIZONS.map((horizon) => (
                  <option key={horizon}>{horizon}</option>
                ))}
              </select>
              <Button type="submit" disabled={addRoadmap.isPending}>
                <Plus /> Add
              </Button>
            </form>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ROADMAP_HORIZONS.map((horizon) => (
              <Card key={horizon}>
                <CardHeader>
                  <CardTitle className="capitalize">{horizon}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {roadmap?.filter((item) => item.horizon === horizon).map((item) => (
                    <div key={item.id} className="rounded-lg bg-surface-2 p-3">
                      <p className="text-sm font-medium">{item.title}</p>
                      {item.description ? (
                        <p className="mt-1 text-xs text-muted">{item.description}</p>
                      ) : null}
                    </div>
                  )) || <p className="text-sm text-muted">Nothing planned.</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="notes">
          <div className="mb-4 flex justify-end">
            <Button onClick={() => addNote.mutate()} disabled={addNote.isPending}>
              <Plus /> New note
            </Button>
          </div>
          {notes?.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {notes.map((note) => (
                <Link
                  key={note.id}
                  to={`/personal/notes/${note.id}`}
                  className="rounded-xl border border-border-subtle bg-surface/70 p-4 hover:border-border"
                >
                  <FileText className="mb-3 size-4 text-accent" />
                  <p className="font-medium">{note.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{note.body || 'Empty note'}</p>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No notes yet"
              description="Keep project decisions and research in one place."
            />
          )}
        </TabsContent>

        <TabsContent value="activity">
          <div className="space-y-3">
            {activity?.length ? (
              activity.map((event) => (
                <div key={event.id} className="rounded-xl border border-border-subtle bg-surface/70 p-4">
                  <div className="flex justify-between gap-3">
                    <p className="text-sm font-medium">{event.summary}</p>
                    <time className="shrink-0 text-xs text-muted">
                      {formatRelative(event.created_at)}
                    </time>
                  </div>
                  <p className="mt-1 text-xs capitalize text-muted">
                    {event.action} · {event.entity_type.replace('_', ' ')}
                  </p>
                </div>
              ))
            ) : (
              <EmptyState title="No project activity yet" />
            )}
          </div>
        </TabsContent>

        <TabsContent value="ai">
          <EmptyState
            title="Work with AI"
            description="Use this project as context in a focused AI conversation."
            action={
              <Button asChild>
                <Link to={`/personal/ai?projectId=${id}`}>
                  <ExternalLink /> Open AI
                </Link>
              </Button>
            }
          />
        </TabsContent>

        <TabsContent value="settings">
          <Card className="max-w-2xl">
            <CardContent className="space-y-4 pt-5">
              <div className="space-y-2">
                <Label htmlFor="project-name">{t('projects.name')}</Label>
                <Input
                  id="project-name"
                  value={settings.name}
                  onChange={(event) =>
                    setSettings((value) => ({ ...value, name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-description">{t('projects.desc')}</Label>
                <Textarea
                  id="project-description"
                  value={settings.description}
                  onChange={(event) =>
                    setSettings((value) => ({ ...value, description: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t('projects.icon')}</Label>
                <ProjectIconPicker
                  value={settings.icon}
                  onChange={(icon) => setSettings((value) => ({ ...value, icon }))}
                  color={settings.color}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('projects.color')}</Label>
                <div className="flex gap-2">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Use ${color}`}
                      onClick={() => setSettings((value) => ({ ...value, color }))}
                      className="size-7 rounded-full border-2"
                      style={{
                        backgroundColor: color,
                        borderColor: settings.color === color ? '#fff' : 'transparent',
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Labels</Label>
                <ProjectLabelPicker
                  labels={labelsQuery.data ?? []}
                  selectedIds={labelIds}
                  onChange={onLabelsChange}
                  disabled={saveLabels.isPending}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="project-status">{t('tasks.status')}</Label>
                  <select
                    id="project-status"
                    value={settings.status}
                    onChange={(event) =>
                      setSettings((value) => ({
                        ...value,
                        status: event.target.value as ProjectStatus,
                      }))
                    }
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-priority">{t('tasks.priority')}</Label>
                  <select
                    id="project-priority"
                    value={settings.priority}
                    onChange={(event) =>
                      setSettings((value) => ({
                        ...value,
                        priority: event.target.value as Priority,
                      }))
                    }
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button
                onClick={() => save.mutate()}
                disabled={!settings.name.trim() || save.isPending}
              >
                {t('common.save')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {(['ideas', 'meetings', 'releases', 'files', 'documentation'] as Tab[]).map((item) => (
          <TabsContent key={item} value={item}>
            <EmptyState
              title={`${tabLabels[item]} coming soon`}
              description="This workspace is ready for the next part of your project workflow."
            />
          </TabsContent>
        ))}
      </Tabs>

      <TaskActionsDialog task={menuTask} onClose={() => setMenuTask(null)} />
    </div>
  )
}
