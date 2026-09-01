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
      await qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceLabelKeys.all(workspaceId) })
      setOpen(false)
      setName('')
      setDescription('')
      setColor(PROJECT_COLORS[0]!)
      setIcon('folder')
      setCreateLabelIds([])
      toast.success(t('workspace.projectCreated'))
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
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.28 }}
            >
              <Link
                to={`/workspace/${workspaceId}/projects/${project.id}`}
                className="flex h-full min-w-0 gap-3 rounded-xl border border-border-subtle bg-surface/70 p-4 transition-colors hover:border-border hover:bg-surface"
              >
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-background"
                  style={{ backgroundColor: project.color || '#60a5fa' }}
                >
                  <ProjectIcon icon={project.icon} size={20} />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{project.name}</p>
                    <HealthBadge health={project.health} />
                    <span className="text-[11px] tabular-nums text-muted">
                      {Math.round(project.completion_pct)}%
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted">
                    {project.description || t('workspace.noDescription')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(projectLinks.data?.byProject?.[project.id] ?? []).map((label) => (
                      <LabelChip key={label.id} name={label.name} color={label.color} />
                    ))}
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
          {!projects.data?.length ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center sm:col-span-2">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.newProject')}</DialogTitle>
            <DialogDescription>{t('workspace.projectsDesc')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim()) return
              create.mutate()
            }}
          >
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
            <div className="space-y-2">
              <Label>{t('workspace.icon')}</Label>
              <ProjectIconPicker value={icon} onChange={setIcon} color={color} />
            </div>
            <div className="space-y-2">
              <Label>{t('workspace.color')}</Label>
              <div className="flex flex-wrap gap-2">
                {PROJECT_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    className="size-8 rounded-full border-2 transition-transform"
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
              <div className="space-y-2">
                <Label>Labels</Label>
                <ProjectLabelPicker
                  labels={labelsQuery.data ?? []}
                  selectedIds={createLabelIds}
                  onChange={setCreateLabelIds}
                />
              </div>
            ) : null}
            <Button type="submit" className="w-full" disabled={create.isPending || !name.trim()}>
              {t('common.create')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
