import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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

export function WorkspaceProjectsPage() {
  const { t } = useTranslation()
  const { workspaceId, canEdit } = useWorkspace()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const projects = useQuery({
    queryKey: workspaceKeys.projects(workspaceId),
    queryFn: () => listWorkspaceProjects(workspaceId),
  })

  const create = useMutation({
    mutationFn: () => createWorkspaceProject(workspaceId, { name }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) })
      setOpen(false)
      setName('')
      toast.success(t('workspace.projectCreated'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title={t('nav.projects')} description={t('workspace.projectsDesc')} />
        {canEdit ? (
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> {t('workspace.newProject')}
          </Button>
        ) : null}
      </div>

      {projects.isLoading ? (
        <div className="mt-6 space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : (
        <div className="mt-6 space-y-2">
          {(projects.data ?? []).map((project) => (
            <Link
              key={project.id}
              to={`/workspace/${workspaceId}/projects/${project.id}`}
              className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface/40 px-4 py-4 hover:bg-surface"
            >
              <span className="size-3 rounded-full" style={{ backgroundColor: project.color }} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{project.name}</p>
                <p className="truncate text-sm text-muted">{project.description || '—'}</p>
              </div>
            </Link>
          ))}
          {!projects.data?.length ? <p className="text-sm text-muted">{t('workspace.noProjects')}</p> : null}
        </div>
      )}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-lg font-medium">{t('workspace.newProject')}</h2>
            <div className="mt-4">
              <Label htmlFor="p-name">{t('workspace.name')}</Label>
              <Input id="p-name" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                {t('common.create')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
