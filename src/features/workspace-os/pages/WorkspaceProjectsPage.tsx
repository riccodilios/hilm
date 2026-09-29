import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useOrgVisibility } from '@/features/workspace-os/context/OrgVisibilityProvider'
import {
  createWorkspaceProject,
  listWorkspaceProjects,
  listWorkspaceTasks,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { ProjectIcon, ProjectIconPicker } from '@/shared/project-icons'
import {
  createWorkspaceLabel,
  deleteWorkspaceLabel,
  listProjectLabels,
  listWorkspaceLabels,
  setProjectLabels,
  updateWorkspaceLabel,
  workspaceLabelKeys,
} from '@/features/workspace-os/labels-api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { LabelsBar } from '@/components/labels/LabelsBar'
import { ProjectLabelPicker } from '@/components/labels/ProjectLabelPicker'
import { LabelChip } from '@/components/labels/LabelChip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { HealthBadge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { PROJECT_COLORS } from '@/types/domain'

export function WorkspaceProjectsPage() {
  const { t } = useTranslation()
  const { workspaceId, canWritePage, canManage } = useWorkspace()
  const canEdit = canWritePage('projects')
  const { filterProjects } = useOrgVisibility()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>(PROJECT_COLORS[0]!)
  const [icon, setIcon] = useState('folder')
  const [createLabelIds, setCreateLabelIds] = useState<string[]>([])
  const [labelFilter, setLabelFilter] = useState<string | 'all'>('all')

  const projects = useQuery({
    queryKey: workspaceKeys.projects(workspaceId),
    queryFn: () => listWorkspaceProjects(workspaceId),
  })
  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
  })

  const labelsQuery = useQuery({
    queryKey: workspaceLabelKeys.all(workspaceId),
    queryFn: () => listWorkspaceLabels(workspaceId),
  })

  const projectLinks = useQuery({
    queryKey: [...workspaceLabelKeys.all(workspaceId), 'links', 'v3'],
    queryFn: async () => {
      const list = projects.data ?? []
      const byProject: Record<string, Array<{ id: string; name: string; color: string }>> = {}
      const ids: Record<string, string[]> = {}
      await Promise.all(
        list.map(async (p) => {
          const labels = await listProjectLabels(workspaceId, p.id)
          byProject[p.id] = labels
          ids[p.id] = labels.map((l) => l.id)
        }),
      )
      return { byProject, ids }
    },
    enabled: Boolean(projects.data?.length),
  })

  const create = useMutation({
    mutationFn: async () => {
      const project = await createWorkspaceProject(workspaceId, {
        name,
        description: description || undefined,
        color,
        icon,
      })
      if (createLabelIds.length) {
        await setProjectLabels(workspaceId, project.id, createLabelIds)
      }
      return project
    },
    onSuccess: async () => {
      setOpen(false)
      setName('')
      setDescription('')
      setColor(PROJECT_COLORS[0]!)
      setIcon('folder')
      setCreateLabelIds([])
      toast.success(t('workspace.projectCreated'))
      await qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceLabelKeys.all(workspaceId) })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const visibleProjects = filterProjects(projects.data ?? [], tasks.data ?? [])

  const filtered = visibleProjects.filter((project) => {
    if (labelFilter === 'all') return true
    return projectLinks.data?.ids?.[project.id]?.includes(labelFilter)
  })

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={t('nav.projects')}
        description={t('workspace.projectsDesc')}
        actions={
          canEdit ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> {t('workspace.newProject')}
            </Button>
          ) : null
        }
      />

      {(projects.data?.length || labelsQuery.data?.length) ? (
        <LabelsBar
          labels={labelsQuery.data ?? []}
          filter={labelFilter}
          onFilterChange={setLabelFilter}
          canManage={canManage}
          queryKey={workspaceLabelKeys.all(workspaceId)}
          createLabel={(input) => createWorkspaceLabel(workspaceId, input)}
          updateLabel={(id, patch) => updateWorkspaceLabel(workspaceId, id, patch)}
          deleteLabel={(id) => deleteWorkspaceLabel(workspaceId, id)}
        />
      ) : null}

      {projects.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((project, index) => (
            <motion.div
              key={project.id}
              className="min-w-0 max-w-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.28 }}
            >
              <Link
                to={`/workspace/${workspaceId}/projects/${project.id}`}
                className="flex h-full min-w-0 max-w-full gap-3 overflow-hidden rounded-xl border border-border-subtle bg-surface/70 p-3 transition-colors hover:border-border hover:bg-surface sm:p-4"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl text-background sm:size-11"
                  style={{ backgroundColor: project.color || '#60a5fa' }}
                >
                  <ProjectIcon icon={project.icon} size={20} />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 max-w-full flex-1 basis-[8rem] truncate font-medium">
                      {project.name}
                    </p>
                    <HealthBadge health={project.health} />
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {Math.round(project.completion_pct)}%
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted">
                    {project.description || t('workspace.noDescription')}
                  </p>
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {(projectLinks.data?.byProject?.[project.id] ?? []).map((label) => (
                      <LabelChip key={label.id} name={label.name} color={label.color} />
                    ))}
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
          {!projects.data?.length ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-14 text-center sm:col-span-2 sm:px-6">
              <h3 className="text-base font-medium">{t('workspace.noProjects')}</h3>
              <p className="mt-1 text-sm text-muted">{t('workspace.projectsDesc')}</p>
              {canEdit ? (
                <Button className="mt-4" onClick={() => setOpen(true)}>
                  <Plus className="size-4" /> {t('workspace.newProject')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            'flex flex-col gap-0 overflow-hidden p-0',
            'left-0 top-auto bottom-0 max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-0.5rem))] w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-3xl',
            'sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-h-[min(90dvh,52rem)] sm:w-[calc(100%-2rem)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
          )}
        >
          <div className="shrink-0 border-b border-border-subtle px-5 pb-3 pt-5 pe-12 sm:px-6 sm:pb-4 sm:pt-6">
            <DialogHeader>
              <DialogTitle>{t('workspace.newProject')}</DialogTitle>
              <DialogDescription>{t('workspace.projectsDesc')}</DialogDescription>
            </DialogHeader>
          </div>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim()) return
              create.mutate()
            }}
          >
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4 sm:space-y-4 sm:px-6 sm:py-5">
              <div className="space-y-2">
                <Label htmlFor="ws-project-name">{t('workspace.name')}</Label>
                <Input
                  id="ws-project-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ws-project-desc">{t('workspace.description')}</Label>
                <Input
                  id="ws-project-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="min-w-0 space-y-2">
                <Label>{t('workspace.icon')}</Label>
                <ProjectIconPicker compact value={icon} onChange={setIcon} color={color} />
              </div>
              <div className="min-w-0 space-y-2">
                <Label>{t('workspace.color')}</Label>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(1.75rem,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(2rem,1fr))]">
                  {PROJECT_COLORS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className="aspect-square w-full max-w-8 rounded-full border-2 transition-transform"
                      style={{
                        backgroundColor: swatch,
                        borderColor: color === swatch ? 'var(--foreground)' : 'transparent',
                        transform: color === swatch ? 'scale(1.1)' : undefined,
                      }}
                      aria-label={swatch}
                      onClick={() => setColor(swatch)}
                    />
                  ))}
                </div>
              </div>
              {canEdit ? (
                <div className="min-w-0 space-y-2">
                  <Label>Labels</Label>
                  <ProjectLabelPicker
                    labels={labelsQuery.data ?? []}
                    selectedIds={createLabelIds}
                    onChange={setCreateLabelIds}
                  />
                </div>
              ) : null}
            </div>
            <div className="shrink-0 border-t border-border-subtle px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-4">
              <Button type="submit" className="w-full" disabled={create.isPending || !name.trim()}>
                {t('common.create')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
