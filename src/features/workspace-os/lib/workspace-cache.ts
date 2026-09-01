import type { QueryClient } from '@tanstack/react-query'
import { workspaceKeys, type WorkspaceTask } from '@/features/workspace-os/api'

export function patchWorkspaceTasksCache(
  qc: QueryClient,
  workspaceId: string,
  taskId: string,
  patch: Partial<WorkspaceTask>,
) {
  qc.setQueryData<WorkspaceTask[]>(workspaceKeys.tasks(workspaceId), (old) =>
    old?.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
  )
  qc.setQueryData<WorkspaceTask>(
    workspaceKeys.task(workspaceId, taskId),
    (old) => (old ? { ...old, ...patch } : old),
  )
}

export function removeWorkspaceTaskFromCache(
  qc: QueryClient,
  workspaceId: string,
  taskId: string,
) {
  qc.setQueryData<WorkspaceTask[]>(workspaceKeys.tasks(workspaceId), (old) =>
    old?.filter((task) => task.id !== taskId),
  )
}
