import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import {
  Brain,
  CheckSquare,
  FolderKanban,
  Home,
  Plus,
  Search,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  getWorkspace,
  listWorkspaceProjects,
  listWorkspaceTasks,
  workspaceKeys,
} from '@/features/workspace-os/api'
import {
  formatWorkspaceTaskRef,
  matchesWorkspaceTaskRef,
} from '@/features/workspace-os/lib/task-refs'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { CommandPaletteItem, useCommandPaletteHotkey } from '@/shared/command-palette/chrome'

export function WorkspaceCommandPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const { workspaceId } = useWorkspace()
  const ws = `/workspace/${workspaceId}`

  useCommandPaletteHotkey(setOpen)

  const workspaceProjects = useQuery({
    queryKey: workspaceKeys.projects(workspaceId),
    queryFn: () => listWorkspaceProjects(workspaceId),
    enabled: open,
  })
  const workspaceTasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
    enabled: open,
  })
  const workspaceDetail = useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => getWorkspace(workspaceId),
    enabled: open,
  })

  const projects = workspaceProjects.data ?? []
  const tasks = workspaceTasks.data ?? []
  const taskKey = workspaceDetail.data?.task_key

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return {
        projects: projects.slice(0, 5),
        tasks: tasks.slice(0, 5),
      }
    }
    return {
      projects: projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8),
      tasks: tasks
        .filter((item) => {
          if (item.title.toLowerCase().includes(q)) return true
          if (matchesWorkspaceTaskRef(query, taskKey, item.task_number)) return true
          return false
        })
        .slice(0, 8),
    }
  }, [query, projects, tasks, taskKey])

  function go(path: string) {
    setOpen(false)
    setQuery('')
    navigate(path)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label={t('common.close')}
        onClick={() => setOpen(false)}
      />
      <div className="relative mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <Command label={t('command.commands')} className="bg-transparent" shouldFilter={false}>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 text-muted" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={t('command.placeholder')}
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-fg"
            />
          </div>
          <Command.List className="max-h-[420px] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted">
              {t('common.noResults')}
            </Command.Empty>

            <Command.Group heading={t('command.commands')} className="px-1 py-2 text-xs text-muted">
              <CommandPaletteItem onSelect={() => go(`${ws}/tasks?new=1`)} icon={Plus} label={t('command.newTask')} />
              <CommandPaletteItem
                onSelect={() => go(`${ws}/projects`)}
                icon={FolderKanban}
                label={t('command.newProject')}
              />
              <CommandPaletteItem onSelect={() => go(ws)} icon={Home} label={t('nav.home')} />
              <CommandPaletteItem onSelect={() => go(`${ws}/tasks`)} icon={CheckSquare} label={t('command.tasks')} />
              <CommandPaletteItem onSelect={() => go(`${ws}/team`)} icon={Users} label={t('nav.team')} />
              <CommandPaletteItem onSelect={() => go(`${ws}/ai`)} icon={Brain} label={t('command.askAi')} />
              <CommandPaletteItem onSelect={() => go(`${ws}/ai`)} icon={Sparkles} label={t('command.chief')} />
              <CommandPaletteItem onSelect={() => go(`${ws}/profile`)} icon={UserRound} label={t('nav.profile')} />
            </Command.Group>

            {filtered.projects.length ? (
              <Command.Group heading={t('command.projects')} className="px-1 py-2 text-xs text-muted">
                {filtered.projects.map((p) => (
                  <CommandPaletteItem
                    key={p.id}
                    onSelect={() => go(`${ws}/projects/${p.id}`)}
                    icon={FolderKanban}
                    label={p.name}
                  />
                ))}
              </Command.Group>
            ) : null}

            {filtered.tasks.length ? (
              <Command.Group heading={t('command.tasks')} className="px-1 py-2 text-xs text-muted">
                {filtered.tasks.map((task) => {
                  const ref = taskKey ? formatWorkspaceTaskRef(taskKey, task.task_number) : null
                  return (
                    <CommandPaletteItem
                      key={task.id}
                      onSelect={() => go(`${ws}/tasks/${task.id}`)}
                      icon={CheckSquare}
                      label={ref ? `${ref} — ${task.title}` : task.title}
                    />
                  )
                })}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
