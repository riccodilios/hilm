import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, FolderInput, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Meeting, MeetingMoveTargets, MeetingProjectOption, MeetingScope } from '../types'

export function MeetingMoveDialog({
  meeting,
  scope,
  targets,
  pending,
  onOpenChange,
  onMove,
}: {
  meeting: Meeting | null
  scope: MeetingScope
  targets: MeetingMoveTargets
  pending: boolean
  onOpenChange: (open: boolean) => void
  onMove: (project: MeetingProjectOption) => void
}) {
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const open = Boolean(meeting)

  const projects = useQuery({
    queryKey: ['meetings', scope.os, 'move-targets', scope.workspaceId ?? scope.userId, scope.projectId],
    queryFn: targets.list,
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setSearch('')
    setSelected(null)
  }, [open, meeting?.id])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (projects.data ?? [])
      .filter((project) => !query || project.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language))
  }, [i18n.language, projects.data, search])

  const target = (projects.data ?? []).find((project) => project.id === selected) ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('meetings.move.title')}</DialogTitle>
          <DialogDescription>
            {t('meetings.move.description', { title: meeting?.title ?? '' })}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('meetings.move.search')}
            aria-label={t('meetings.move.search')}
            className="ps-9"
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-border-subtle" role="listbox" aria-label={t('meetings.move.title')}>
          {projects.isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : projects.isError ? (
            <div className="space-y-2 p-4 text-center text-sm text-muted">
              <p>{t('meetings.move.loadFailed')}</p>
              <Button size="sm" variant="secondary" onClick={() => void projects.refetch()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : !filtered.length ? (
            <p className="p-4 text-center text-sm text-muted">
              {projects.data?.length ? t('meetings.move.noMatches') : t('meetings.move.noProjects')}
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {filtered.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected === project.id}
                    onClick={() => setSelected(project.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2.5 text-start text-sm transition-colors hover:bg-surface-2',
                      selected === project.id && 'bg-accent/10',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {project.name}
                    </span>
                    {selected === project.id ? <Check className="size-4 shrink-0 text-accent" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted">{t('meetings.move.tasksNote')}</p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={!target || pending} onClick={() => target && onMove(target)}>
            {pending ? <Loader2 className="animate-spin" /> : <FolderInput />} {t('meetings.move.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
