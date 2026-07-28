import { useEffect, useMemo, useState } from 'react'
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
import { cn } from '@/lib/utils'

export function CommandPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const { data: projects = [] } = useQuery({
    queryKey: projectsKeys.list(),
    queryFn: listProjects,
    enabled: open,
  })
  const { data: tasks = [] } = useQuery({
    queryKey: tasksKeys.list('palette'),
    queryFn: () => listTasks(),
    enabled: open,
  })
  const { data: notes = [] } = useQuery({
    queryKey: notesKeys.list(),
    queryFn: () => listNotes(),
    enabled: open,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    const onCustom = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('hilm:open-command', onCustom)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('hilm:open-command', onCustom)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return {
        projects: projects.slice(0, 5),
        tasks: tasks.slice(0, 5),
        notes: notes.slice(0, 5),
      }
    }
    return {
      projects: projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8),
      tasks: tasks.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 8),
      notes: notes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8),
    }
  }, [query, projects, tasks, notes])

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
              <Item onSelect={() => go('/app/tasks?new=1')} icon={Plus} label={t('command.newTask')} />
              <Item onSelect={() => go('/app/projects')} icon={FolderKanban} label={t('command.newProject')} />
              <Item onSelect={() => go('/app')} icon={Home} label={t('command.today')} />
              <Item onSelect={() => go('/app/ai')} icon={Brain} label={t('command.askAi')} />
              <Item onSelect={() => go('/app/notes')} icon={NotebookPen} label={t('command.quickNote')} />
              <Item onSelect={() => go('/app/search')} icon={Search} label={t('command.openSearch')} />
              <Item onSelect={() => go('/app/ai')} icon={Sparkles} label={t('command.chief')} />
              <Item onSelect={() => go('/app/tasks/board')} icon={CheckSquare} label={t('command.kanban')} />
            </Command.Group>

            {filtered.projects.length ? (
              <Command.Group heading={t('command.projects')} className="px-1 py-2 text-xs text-muted">
                {filtered.projects.map((p) => (
                  <Item
                    key={p.id}
                    onSelect={() => go(`/app/projects/${p.id}`)}
                    icon={FolderKanban}
                    label={p.name}
                  />
                ))}
              </Command.Group>
            ) : null}

            {filtered.tasks.length ? (
              <Command.Group heading={t('command.tasks')} className="px-1 py-2 text-xs text-muted">
                {filtered.tasks.map((t) => (
                  <Item
                    key={t.id}
                    onSelect={() => go(`/app/tasks/${t.id}`)}
                    icon={CheckSquare}
                    label={t.title}
                  />
                ))}
              </Command.Group>
            ) : null}

            {filtered.notes.length ? (
              <Command.Group heading={t('command.notes')} className="px-1 py-2 text-xs text-muted">
                {filtered.notes.map((n) => (
                  <Item
                    key={n.id}
                    onSelect={() => go(`/app/notes/${n.id}`)}
                    icon={NotebookPen}
                    label={n.title}
                  />
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </div>
    </div>
  )
}

function Item({
  label,
  icon: Icon,
  onSelect,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onSelect: () => void
}) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground aria-selected:bg-surface-2',
      )}
    >
      <Icon className="size-4 text-muted" />
      <span className="truncate">{label}</span>
    </Command.Item>
  )
}
