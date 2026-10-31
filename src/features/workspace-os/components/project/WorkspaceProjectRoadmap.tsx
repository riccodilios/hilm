import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  completeWorkspaceRoadmapItem,
  createWorkspaceRoadmapItem,
  deleteWorkspaceRoadmapItem,
  listWorkspaceRoadmap,
  projectContentKeys,
  updateWorkspaceRoadmapItem,
  type WorkspaceRoadmapItem,
} from '@/features/workspace-os/project-content-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/page'
import { Textarea } from '@/components/ui/textarea'
import { ROADMAP_HORIZONS, type RoadmapHorizon } from '@/types/domain'

export function WorkspaceProjectRoadmap({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string
  projectId: string
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [horizon, setHorizon] = useState<RoadmapHorizon>('next')
  const key = projectContentKeys.roadmap(workspaceId, projectId)
  const roadmap = useQuery({ queryKey: key, queryFn: () => listWorkspaceRoadmap(workspaceId, projectId) })
  const refresh = () => qc.invalidateQueries({ queryKey: key })

  const add = useMutation({
    mutationFn: () => createWorkspaceRoadmapItem(workspaceId, { projectId, title: title.trim(), horizon }),
    onSuccess: async () => {
      setTitle('')
      await refresh()
      toast.success(t('projects.roadmapAdded'))
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const save = useMutation({
    mutationFn: (input: { id: string; patch: Partial<Pick<WorkspaceRoadmapItem, 'title' | 'description' | 'horizon'>> }) =>
      updateWorkspaceRoadmapItem(workspaceId, input.id, input.patch),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  })
  const complete = useMutation({
    mutationFn: (id: string) => completeWorkspaceRoadmapItem(workspaceId, projectId, id),
    onSuccess: async () => {
      await refresh()
      toast.success(t('projects.roadmapCompleted'))
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteWorkspaceRoadmapItem(workspaceId, id),
    onSuccess: async () => {
      await refresh()
      toast.success(t('projects.roadmapRemoved'))
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const busy = !canEdit || add.isPending || save.isPending || complete.isPending || remove.isPending

  if (roadmap.isLoading) return <Skeleton className="h-64" />

  return (
    <div>
      {canEdit ? (
        <div className="mb-5 rounded-2xl border border-border-subtle bg-surface/70 p-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              if (title.trim()) add.mutate()
            }}
          >
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('projects.roadmapAddPlaceholder')}
              maxLength={300}
            />
            <select
              value={horizon}
              onChange={(event) => setHorizon(event.target.value as RoadmapHorizon)}
              className="h-10 rounded-lg border border-border bg-surface px-3 text-sm"
            >
              {ROADMAP_HORIZONS.map((option) => (
                <option key={option} value={option}>
                  {t(`projects.roadmapHorizon.${option}`)}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={add.isPending || !title.trim()}>
              <Plus /> {t('common.create')}
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted">{t('projects.roadmapHint')}</p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ROADMAP_HORIZONS.map((column) => {
          const items = (roadmap.data ?? []).filter((item) => item.horizon === column)
          return (
            <Card key={column}>
              <CardHeader>
                <CardTitle>{t(`projects.roadmapHorizon.${column}`)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="space-y-2 rounded-lg bg-surface-2 p-3">
                    <Input
                      defaultValue={item.title}
                      disabled={busy}
                      maxLength={300}
                      aria-label={t('projects.roadmapTitle')}
                      className="h-9 bg-surface text-sm font-medium"
                      onBlur={(event) => {
                        const next = event.target.value.trim()
                        if (!next || next === item.title) {
                          event.target.value = item.title
                          return
                        }
                        save.mutate({ id: item.id, patch: { title: next } })
                      }}
                    />
                    <Textarea
                      defaultValue={item.description ?? ''}
                      disabled={busy}
                      maxLength={5000}
                      aria-label={t('projects.desc')}
                      placeholder={t('projects.roadmapNotesPlaceholder')}
                      className="min-h-16 bg-surface text-xs"
                      onBlur={(event) => {
                        const description = event.target.value.trim() || null
                        if (description === (item.description ?? null)) return
                        save.mutate({ id: item.id, patch: { description } })
                      }}
                    />
                    {canEdit ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={item.horizon}
                          disabled={busy}
                          aria-label={t('projects.roadmapMove')}
                          onChange={(event) =>
                            save.mutate({ id: item.id, patch: { horizon: event.target.value as RoadmapHorizon } })
                          }
                          className="h-8 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
                        >
                          {ROADMAP_HORIZONS.map((option) => (
                            <option key={option} value={option}>
                              {t(`projects.roadmapHorizon.${option}`)}
                            </option>
                          ))}
                        </select>
                        {column === 'now' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => complete.mutate(item.id)}
                          >
                            <Check /> {t('common.complete')}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8 text-muted hover:text-danger"
                          disabled={busy}
                          aria-label={t('common.delete')}
                          onClick={() => remove.mutate(item.id)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                {!items.length ? <p className="text-sm text-muted">{t('projects.roadmapEmpty')}</p> : null}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
