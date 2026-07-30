import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  createWorkspaceProject,
  listWorkspaceProjects,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
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

const COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185']

export function WorkspaceProjectsPage() {
  const { t } = useTranslation()
  const { workspaceId, canEdit } = useWorkspace()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLORS[0]!)

  const projects = useQuery({
    queryKey: workspaceKeys.projects(workspaceId),
    queryFn: () => listWorkspaceProjects(workspaceId),
  })

  const create = useMutation({
    mutationFn: () =>
      createWorkspaceProject(workspaceId, {
        name,
        description: description || undefined,
        color,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) })
      setOpen(false)
      setName('')
      setDescription('')
      setColor(COLORS[0]!)
      toast.success(t('workspace.projectCreated'))
    },
    onError: (error: Error) => toast.error(error.message),
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

      {projects.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(projects.data ?? []).map((project, index) => (
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
                <div className="relative flex size-11 shrink-0 items-center justify-center">
                  <svg width={44} height={44} className="-rotate-90" aria-hidden>
                    <circle
                      cx={22}
                      cy={22}
                      r={18}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3.5}
                      className="text-surface-3"
                    />
                    <circle
                      cx={22}
                      cy={22}
                      r={18}
                      fill="none"
                      stroke={project.color || '#60a5fa'}
                      strokeWidth={3.5}
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 18}
                      strokeDashoffset={
                        2 * Math.PI * 18 -
                        (Math.max(0, Math.min(100, project.completion_pct)) / 100) * 2 * Math.PI * 18
                      }
                    />
                  </svg>
                  <span className="absolute text-[10px] font-medium tabular-nums">
                    {Math.round(project.completion_pct)}%
                  </span>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{project.name}</p>
                    <HealthBadge health={project.health} />
                  </div>
                  <p className="line-clamp-2 text-sm text-muted">
                    {project.description || t('workspace.noDescription')}
                  </p>
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
              <Label>{t('workspace.color')}</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((swatch) => (
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
            <Button type="submit" className="w-full" disabled={!name.trim() || create.isPending}>
              {t('common.create')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
