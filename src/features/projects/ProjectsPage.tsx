import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Pencil, Plus, Trash2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  createProject,
  deleteProject,
  listProjects,
  projectsKeys,
  updateProject,
} from '@/features/projects/api'
import {
  createLabel,
  deleteLabel,
  labelKeys,
  listLabels,
  listProjectLabels,
  setProjectLabels,
  updateLabel,
} from '@/features/projects/labels-api'
import { LabelsBar } from '@/components/labels/LabelsBar'
import { ProjectLabelPicker } from '@/components/labels/ProjectLabelPicker'
import { LabelChip } from '@/components/labels/LabelChip'
import { homeKeys } from '@/features/home/api'
import { ProjectIcon, ProjectIconPicker } from '@/features/projects/icons'
import { useLongPress } from '@/hooks/useLongPress'
import { PageHeader, EmptyState, Skeleton } from '@/components/ui/page'
import { Button } from '@/components/ui/button'
import { HealthBadge, PriorityBadge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PROJECT_COLORS } from '@/types/domain'
import type { Tables } from '@/types/database'

type Project = Tables<'projects'>

function ProjectCard({
  project,
  labels,
  onOpenMenu,
}: {
  project: Project
  labels: Array<{ id: string; name: string; color: string }>
  onOpenMenu: (project: Project) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const longPressed = useRef(false)

  const longPress = useLongPress(() => {
    longPressed.current = true
    onOpenMenu(project)
  })

  return (
    <div
      role="link"
      tabIndex={0}
      className="group cursor-pointer touch-manipulation select-none rounded-2xl border border-border-subtle bg-surface/70 p-5 transition-colors hover:border-border hover:bg-surface"
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false
          return
        }
        navigate(`/personal/projects/${project.id}`)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(`/personal/projects/${project.id}`)
        }
      }}
      {...longPress}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex size-10 items-center justify-center rounded-xl text-background"
            style={{ backgroundColor: project.color }}
          >
            <ProjectIcon icon={project.icon} size={18} />
          </span>
          <div>
            <h2 className="font-medium tracking-tight">{project.name}</h2>
            <p className="line-clamp-1 text-sm text-muted">
              {project.description || t('projects.noDescription')}
            </p>
          </div>
        </div>
        <HealthBadge health={project.health} />
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-accent/70 transition-all"
            style={{ width: `${project.completion_pct}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted">{project.completion_pct}%</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PriorityBadge priority={project.priority} />
        {labels.map((label) => (
          <LabelChip key={label.id} name={label.name} color={label.color} />
        ))}
      </div>
    </div>
  )
}

export function ProjectsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: projectsKeys.list(), queryFn: listProjects })
  const labelsQuery = useQuery({
    queryKey: labelKeys.list(),
    queryFn: listLabels,
  })
  const [labelFilter, setLabelFilter] = useState<string | 'all'>('all')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>(PROJECT_COLORS[0])
  const [icon, setIcon] = useState('folder')
  const [createLabelIds, setCreateLabelIds] = useState<string[]>([])
  const [menuProject, setMenuProject] = useState<Project | null>(null)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editColor, setEditColor] = useState<string>(PROJECT_COLORS[0])
  const [editIcon, setEditIcon] = useState('folder')
  const [editLabelIds, setEditLabelIds] = useState<string[]>([])

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: projectsKeys.all }),
      qc.invalidateQueries({ queryKey: homeKeys.all }),
      qc.invalidateQueries({ queryKey: labelKeys.all }),
    ])

  const create = useMutation({
    mutationFn: async () => {
      const project = await createProject({ name, description, color, icon })
      if (createLabelIds.length) await setProjectLabels(project.id, createLabelIds)
      return project
    },
    onSuccess: async () => {
      await invalidate()
      setOpen(false)
      setName('')
      setDescription('')
      setIcon('folder')
      setColor(PROJECT_COLORS[0])
      setCreateLabelIds([])
      toast.success(t('projects.created'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const saveEdit = useMutation({
    mutationFn: async () => {
      await updateProject(editProject!.id, {
        name: editName.trim(),
        description: editDescription,
        color: editColor,
        icon: editIcon,
      })
      await setProjectLabels(editProject!.id, editLabelIds)
    },
    onSuccess: async () => {
      await invalidate()
      setEditProject(null)
      toast.success(t('projects.updated'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: async () => {
      await invalidate()
      setMenuProject(null)
      toast.success(t('projects.deleted'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const projectLinks = useQuery({
    queryKey: [...labelKeys.all, 'links'],
    queryFn: async () => {
      const projects = data ?? []
      const map = new Map<string, Array<{ id: string; name: string; color: string }>>()
      const idMap = new Map<string, string[]>()
      await Promise.all(
        projects.map(async (p) => {
          const labels = await listProjectLabels(p.id)
          map.set(p.id, labels)
          idMap.set(
            p.id,
            labels.map((l) => l.id),
          )
        }),
      )
      return { byProject: map, ids: idMap }
    },
    enabled: Boolean(data?.length),
  })

  function openEdit(project: Project) {
    setMenuProject(null)
    setEditProject(project)
    setEditName(project.name)
    setEditDescription(project.description ?? '')
    setEditColor(project.color)
    setEditIcon(project.icon ?? 'folder')
    setEditLabelIds(projectLinks.data?.ids.get(project.id) ?? [])
  }

  const filteredProjects = (data ?? []).filter((project) => {
    if (labelFilter === 'all') return true
    return projectLinks.data?.ids.get(project.id)?.includes(labelFilter)
  })

  return (
    <div>
      <PageHeader
        title={t('projects.title')}
        description={t('projects.description')}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" /> {t('projects.new')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('projects.new')}</DialogTitle>
                <DialogDescription>{t('projects.description')}</DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  create.mutate()
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="name">{t('projects.name')}</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desc">{t('projects.desc')}</Label>
                  <Textarea
                    id="desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('projects.icon')}</Label>
                  <ProjectIconPicker value={icon} onChange={setIcon} color={color} />
                </div>
                <div className="space-y-2">
                  <Label>{t('projects.color')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {PROJECT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className="size-7 rounded-full border-2"
                        style={{
                          backgroundColor: c,
                          borderColor: color === c ? '#fff' : 'transparent',
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Labels</Label>
                  <ProjectLabelPicker
                    labels={labelsQuery.data ?? []}
                    selectedIds={createLabelIds}
                    onChange={setCreateLabelIds}
                  />
                </div>
                <Button type="submit" disabled={create.isPending} className="w-full">
                  {t('common.create')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : !data?.length ? (
        <EmptyState
          title={t('projects.emptyTitle')}
          description={t('projects.emptyBody')}
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> {t('projects.new')}
            </Button>
          }
        />
      ) : (
        <>
          <LabelsBar
            labels={labelsQuery.data ?? []}
            filter={labelFilter}
            onFilterChange={setLabelFilter}
            canManage
            queryKey={labelKeys.all}
            createLabel={createLabel}
            updateLabel={updateLabel}
            deleteLabel={deleteLabel}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                labels={projectLinks.data?.byProject.get(project.id) ?? []}
                onOpenMenu={setMenuProject}
              />
            ))}
          </div>
        </>
      )}

      <Dialog open={Boolean(menuProject)} onOpenChange={(next) => !next && setMenuProject(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {menuProject ? (
                <span
                  className="flex size-10 items-center justify-center rounded-xl text-background"
                  style={{ backgroundColor: menuProject.color }}
                >
                  <ProjectIcon icon={menuProject.icon} size={18} />
                </span>
              ) : null}
              {menuProject?.name}
            </DialogTitle>
            <DialogDescription>{t('projects.actionsHint')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button
              variant="secondary"
              className="justify-start"
              onClick={() => {
                if (!menuProject) return
                const id = menuProject.id
                setMenuProject(null)
                navigate(`/personal/projects/${id}`)
              }}
            >
              <ExternalLink className="size-4" /> {t('projects.open')}
            </Button>
            <Button
              variant="secondary"
              className="justify-start"
              onClick={() => menuProject && openEdit(menuProject)}
            >
              <Pencil className="size-4" /> {t('projects.edit')}
            </Button>
            <Button
              variant="secondary"
              className="justify-start text-[color:var(--color-danger)]"
              disabled={remove.isPending}
              onClick={() => {
                if (!menuProject) return
                if (!window.confirm(t('projects.deleteConfirm', { name: menuProject.name }))) return
                remove.mutate(menuProject.id)
              }}
            >
              <Trash2 className="size-4" /> {t('projects.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editProject)} onOpenChange={(next) => !next && setEditProject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('projects.edit')}</DialogTitle>
            <DialogDescription>{t('projects.editDesc')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (editName.trim()) saveEdit.mutate()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="edit-name">{t('projects.name')}</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-desc">{t('projects.desc')}</Label>
              <Textarea
                id="edit-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('projects.icon')}</Label>
              <ProjectIconPicker value={editIcon} onChange={setEditIcon} color={editColor} />
            </div>
            <div className="space-y-2">
              <Label>{t('projects.color')}</Label>
              <div className="flex flex-wrap gap-2">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditColor(c)}
                    className="size-7 rounded-full border-2"
                    style={{
                      backgroundColor: c,
                      borderColor: editColor === c ? '#fff' : 'transparent',
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Labels</Label>
              <ProjectLabelPicker
                labels={labelsQuery.data ?? []}
                selectedIds={editLabelIds}
                onChange={setEditLabelIds}
              />
            </div>
            <Button type="submit" disabled={saveEdit.isPending} className="w-full">
              {t('common.save')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
