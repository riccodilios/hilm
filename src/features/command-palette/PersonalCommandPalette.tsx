import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import {
  Brain,
  CheckSquare,
  FolderKanban,
  Home,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { listTasks, tasksKeys } from '@/features/tasks/api'
import { listNotes, notesKeys } from '@/features/notes/api'
import { CommandPaletteItem, useCommandPaletteHotkey } from '@/shared/command-palette/chrome'

export function PersonalCommandPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  useCommandPaletteHotkey(setOpen)

  const personalProjects = useQuery({
    queryKey: projectsKeys.list(),
    queryFn: listProjects,
    enabled: open,
  })
  const personalTasks = useQuery({
    queryKey: tasksKeys.list('palette'),
    queryFn: () => listTasks(),
    enabled: open,
  })
  const notes = useQuery({
    queryKey: notesKeys.list(),
    queryFn: () => listNotes(),
    enabled: open,
  })

  const projects = personalProjects.data ?? []
  const tasks = personalTasks.data ?? []
  const noteItems = notes.data ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return {
        projects: projects.slice(0, 5),
        tasks: tasks.slice(0, 5),
        notes: noteItems.slice(0, 5),
      }
    }
    return {
      projects: projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8),
      tasks: tasks.filter((item) => item.title.toLowerCase().includes(q)).slice(0, 8),
      notes: noteItems.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8),
    }
  }, [query, projects, tasks, noteItems])

  function go(path: string) {
    setOpen(false)
    setQuery('')
    navigate(path)
  }

  if (!open) return null

  return (
    <CommandPaletteOverlay onClose={() => setOpen(false)}>
      <Command label={t('command.commands')} className="bg-transparent" shouldFilter={false}>
        <CommandPaletteInput query={query} onQueryChange={setQuery} />
        <Command.List className="max-h-[420px] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-8 text-center text-sm text-muted">
            {t('common.noResults')}
          </Command.Empty>

          <Command.Group heading={t('command.commands')} className="px-1 py-2 text-xs text-muted">
            <CommandPaletteItem onSelect={() => go('/personal/tasks?new=1')} icon={Plus} label={t('command.newTask')} />
            <CommandPaletteItem
              onSelect={() => go('/personal/projects')}
              icon={FolderKanban}
              label={t('command.newProject')}
            />
            <CommandPaletteItem onSelect={() => go('/personal')} icon={Home} label={t('command.today')} />
            <CommandPaletteItem onSelect={() => go('/personal/ai')} icon={Brain} label={t('command.askAi')} />
            <CommandPaletteItem
              onSelect={() => go('/personal/notes')}
              icon={NotebookPen}
              label={t('command.quickNote')}
            />
            <CommandPaletteItem onSelect={() => go('/personal/search')} icon={Search} label={t('command.openSearch')} />
            <CommandPaletteItem onSelect={() => go('/personal/ai')} icon={Sparkles} label={t('command.chief')} />
            <CommandPaletteItem
              onSelect={() => go('/personal/tasks/board')}
              icon={CheckSquare}
              label={t('command.kanban')}
            />
          </Command.Group>

          {filtered.projects.length ? (
            <Command.Group heading={t('command.projects')} className="px-1 py-2 text-xs text-muted">
              {filtered.projects.map((p) => (
                <CommandPaletteItem
                  key={p.id}
                  onSelect={() => go(`/personal/projects/${p.id}`)}
                  icon={FolderKanban}
                  label={p.name}
                />
              ))}
            </Command.Group>
          ) : null}

          {filtered.tasks.length ? (
            <Command.Group heading={t('command.tasks')} className="px-1 py-2 text-xs text-muted">
              {filtered.tasks.map((task) => (
                <CommandPaletteItem
                  key={task.id}
                  onSelect={() => go(`/personal/tasks/${task.id}`)}
                  icon={CheckSquare}
                  label={task.title}
                />
              ))}
            </Command.Group>
          ) : null}

          {filtered.notes.length ? (
            <Command.Group heading={t('command.notes')} className="px-1 py-2 text-xs text-muted">
              {filtered.notes.map((n) => (
                <CommandPaletteItem
                  key={n.id}
                  onSelect={() => go(`/personal/notes/${n.id}`)}
                  icon={NotebookPen}
                  label={n.title}
                />
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </CommandPaletteOverlay>
  )
}

function CommandPaletteOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label={t('common.close')}
        onClick={onClose}
      />
      <div className="relative mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {children}
      </div>
    </div>
  )
}

function CommandPaletteInput({
  query,
  onQueryChange,
}: {
  query: string
  onQueryChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 border-b border-border px-4">
      <Search className="size-4 text-muted" />
      <Command.Input
        value={query}
        onValueChange={onQueryChange}
        placeholder={t('command.placeholder')}
        className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-fg"
      />
    </div>
  )
}
