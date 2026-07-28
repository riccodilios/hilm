import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Check, ChevronLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getTask, listSubtasks, tasksKeys, updateTask } from '@/features/tasks/api'
import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, Skeleton } from '@/components/ui/page'
import { PRIORITIES, TASK_STATUSES } from '@/types/domain'
import type { Priority, TaskStatus } from '@/types/domain'

export function TaskDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const { data: task, isLoading } = useQuery({ queryKey: tasksKeys.detail(id ?? ''), queryFn: () => getTask(id!), enabled: Boolean(id) })
  const { data: subtasks } = useQuery({ queryKey: [...tasksKeys.detail(id ?? ''), 'subtasks'], queryFn: () => listSubtasks(id!), enabled: Boolean(id) })
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateTask>[1]) => updateTask(id!, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: tasksKeys.all }); toast.success('Task updated') },
    onError: (error: Error) => toast.error(error.message),
  })
  const addSubtask = useMutation({
    mutationFn: async () => {
      const userId = await requireUserId()
      const { error } = await supabase.from('subtasks').insert({ user_id: userId, task_id: id!, title: subtaskTitle, position: subtasks?.length ?? 0 })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...tasksKeys.detail(id ?? ''), 'subtasks'] }); setSubtaskTitle('') },
    onError: (error: Error) => toast.error(error.message),
  })

  if (isLoading) return <Skeleton className="h-96" />
  if (!task) return <EmptyState title="Task not found" action={<Button asChild><Link to="/tasks">Back to tasks</Link></Button>} />

  return (
    <div className="max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-4"><Link to="/tasks"><ChevronLeft /> Tasks</Link></Button>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-medium tracking-tight">Task details</h1>
        <Button disabled={task.status === 'done' || save.isPending} onClick={() => save.mutate({ status: 'done' })}><Check /> {task.status === 'done' ? 'Completed' : 'Complete task'}</Button>
      </div>
      <div className="space-y-4">
        <Card><CardContent className="space-y-4 pt-5">
          <div className="space-y-2"><Label htmlFor="title">Title</Label><Input id="title" defaultValue={task.title} onBlur={(event) => { if (event.target.value.trim() && event.target.value !== task.title) save.mutate({ title: event.target.value.trim() }) }} /></div>
          <div className="space-y-2"><Label htmlFor="description">Description</Label><Textarea id="description" defaultValue={task.description ?? ''} rows={7} onBlur={(event) => { if (event.target.value !== (task.description ?? '')) save.mutate({ description: event.target.value }) }} /></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="status">Status</Label><select id="status" value={task.status} onChange={(event) => save.mutate({ status: event.target.value as TaskStatus })} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm">{TASK_STATUSES.filter((status) => status !== 'archived').map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="priority">Priority</Label><select id="priority" value={task.priority} onChange={(event) => save.mutate({ priority: event.target.value as Priority })} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm">{PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="due">Due date</Label><Input id="due" type="date" defaultValue={task.due_at?.slice(0, 10) ?? ''} onBlur={(event) => save.mutate({ due_at: event.target.value || null })} /></div>
          </div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Subtasks</CardTitle></CardHeader><CardContent>
          <div className="space-y-2">{subtasks?.map((subtask) => <div key={subtask.id} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm"><span className={`size-2 rounded-full ${subtask.done ? 'bg-success' : 'bg-muted'}`} />{subtask.title}</div>)}</div>
          <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (subtaskTitle.trim()) addSubtask.mutate() }}><Input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Add a subtask" /><Button type="submit" size="icon" disabled={addSubtask.isPending}><Plus /></Button></form>
        </CardContent></Card>
      </div>
    </div>
  )
}
