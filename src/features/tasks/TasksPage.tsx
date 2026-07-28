import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Columns3, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createTask, listTasks, tasksKeys } from '@/features/tasks/api'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PriorityBadge, StatusBadge } from '@/components/ui/badge'
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/page'
import { PRIORITIES, TASK_STATUSES } from '@/types/domain'
import type { Priority, TaskStatus } from '@/types/domain'

export function TasksPage() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<TaskStatus | undefined>()
  const [open, setOpen] = useState(searchParams.get('new') === '1')
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [priority, setPriority] = useState<Priority>('none')
  const [dueAt, setDueAt] = useState('')
  const { data: tasks, isLoading } = useQuery({ queryKey: tasksKeys.list(status), queryFn: () => listTasks(status ? { status } : undefined) })
  const { data: projects } = useQuery({ queryKey: projectsKeys.list(), queryFn: listProjects })
  const create = useMutation({
    mutationFn: createTask,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: tasksKeys.all })
      setOpen(false)
      setSearchParams({})
      setTitle('')
      setProjectId('')
      setPriority('none')
      setDueAt('')
      toast.success('Task created')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  useEffect(() => {
    if (searchParams.get('new') === '1') setOpen(true)
  }, [searchParams])

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Keep your next actions clear and moving."
        actions={<><Button variant="secondary" asChild><Link to="/tasks/board"><Columns3 /> Board</Link></Button><Button onClick={() => setOpen(true)}><Plus /> New task</Button></>}
      />
      <div className="mb-5 flex flex-wrap gap-2">
        <Button size="sm" variant={!status ? 'default' : 'secondary'} onClick={() => setStatus(undefined)}>All</Button>
        {TASK_STATUSES.filter((item) => item !== 'archived').map((item) => (
          <Button key={item} size="sm" variant={status === item ? 'default' : 'secondary'} onClick={() => setStatus(item)} className="capitalize">{item.replace('_', ' ')}</Button>
        ))}
      </div>
      {isLoading ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : !tasks?.length ? (
        <EmptyState title="No tasks found" description="Capture your next action to get started." action={<Button onClick={() => setOpen(true)}><Plus /> New task</Button>} />
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => <Link key={task.id} to={`/tasks/${task.id}`} className="flex items-center justify-between gap-4 rounded-xl border border-border-subtle bg-surface/70 p-4 transition-colors hover:border-border hover:bg-surface">
            <div className="min-w-0"><p className="truncate font-medium">{task.title}</p><p className="mt-1 text-xs text-muted">{task.due_at ? `Due ${new Date(task.due_at).toLocaleDateString()}` : 'No due date'}</p></div>
            <div className="flex shrink-0 items-center gap-2"><PriorityBadge priority={task.priority} /><StatusBadge status={task.status} /></div>
          </Link>)}
        </div>
      )}
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearchParams({}) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New task</DialogTitle><DialogDescription>Add a focused, actionable task.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); create.mutate({ title, projectId: projectId || null, priority, dueAt: dueAt || null }) }}>
            <div className="space-y-2"><Label htmlFor="task-title">Title</Label><Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus /></div>
            <div className="space-y-2"><Label htmlFor="task-project">Project</Label><select id="task-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"><option value="">No project</option>{projects?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="task-priority">Priority</Label><select id="task-priority" value={priority} onChange={(event) => setPriority(event.target.value as Priority)} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm">{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></div><div className="space-y-2"><Label htmlFor="task-due">Due date</Label><Input id="task-due" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></div></div>
            <Button type="submit" className="w-full" disabled={create.isPending}>Create task</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
