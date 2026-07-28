import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createProject, listProjects, projectsKeys } from '@/features/projects/api'
import { homeKeys } from '@/features/home/api'
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

export function ProjectsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: projectsKeys.list(), queryFn: listProjects })
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>(PROJECT_COLORS[0])

  const create = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: projectsKeys.all }),
        qc.invalidateQueries({ queryKey: homeKeys.all }),
      ])
      setOpen(false)
      setName('')
      setDescription('')
      toast.success('Project created')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Everything you build, manage, and ship."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" /> New project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New project</DialogTitle>
                <DialogDescription>Give it a clear name and optional description.</DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  create.mutate({ name, description, color })
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desc">Description</Label>
                  <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Color</Label>
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
                <Button type="submit" disabled={create.isPending} className="w-full">
                  Create
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
          title="No projects yet"
          description="Create Wasl, Finora, Rivalize, Alytic — or whatever you're building."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New project
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((project) => (
            <Link
              key={project.id}
              to={`/app/projects/${project.id}`}
              className="group rounded-2xl border border-border-subtle bg-surface/70 p-5 transition-colors hover:border-border hover:bg-surface"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-10 items-center justify-center rounded-xl text-sm font-medium text-background"
                    style={{ backgroundColor: project.color }}
                  >
                    {project.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <h2 className="font-medium tracking-tight">{project.name}</h2>
                    <p className="line-clamp-1 text-sm text-muted">
                      {project.description || 'No description'}
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
              <div className="mt-3">
                <PriorityBadge priority={project.priority} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
