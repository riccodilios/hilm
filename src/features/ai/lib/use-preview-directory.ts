import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  buildPreviewDirectory,
  emptyPreviewDirectory,
  type PreviewDirectory,
} from '@/features/ai/lib/action-preview'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { listTasks, tasksKeys } from '@/features/tasks/api'
import {
  getWorkspace,
  listWorkspaceMembers,
  listWorkspaceProjects,
  listWorkspaceTasks,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { resolveMemberDisplayName } from '@/features/workspace-os/lib/member-display'

export function usePreviewDirectory(
  os?: 'personal' | 'workspace',
  workspaceId?: string,
  enabled = true,
): PreviewDirectory {
  const isWorkspace = os === 'workspace' && Boolean(workspaceId)

  const workspace = useQuery({
    queryKey: workspaceKeys.detail(workspaceId ?? ''),
    queryFn: () => getWorkspace(workspaceId!),
    enabled: enabled && isWorkspace,
    staleTime: 60_000,
  })
  const workspaceTasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId ?? ''),
    queryFn: () => listWorkspaceTasks(workspaceId!),
    enabled: enabled && isWorkspace,
    staleTime: 30_000,
  })
  const workspaceProjects = useQuery({
    queryKey: workspaceKeys.projects(workspaceId ?? ''),
    queryFn: () => listWorkspaceProjects(workspaceId!),
    enabled: enabled && isWorkspace,
    staleTime: 60_000,
  })
  const workspaceMembers = useQuery({
    queryKey: workspaceKeys.members(workspaceId ?? ''),
    queryFn: () => listWorkspaceMembers(workspaceId!),
    enabled: enabled && isWorkspace,
    staleTime: 60_000,
  })
  const personalProjects = useQuery({
    queryKey: projectsKeys.list(),
    queryFn: listProjects,
    enabled: enabled && !isWorkspace && os === 'personal',
    staleTime: 60_000,
  })
  const personalTasks = useQuery({
    queryKey: tasksKeys.list(),
    queryFn: () => listTasks(),
    enabled: enabled && !isWorkspace && os === 'personal',
    staleTime: 30_000,
  })

  return useMemo(() => {
    if (isWorkspace) {
      return buildPreviewDirectory({
        taskKey: workspace.data?.task_key,
        tasks: workspaceTasks.data,
        projects: workspaceProjects.data?.map((project) => ({
          id: project.id,
          name: project.name,
        })),
        people: workspaceMembers.data?.map((member) => ({
          id: member.user_id,
          name: resolveMemberDisplayName({
            displayNameOverride: member.display_name_override,
            displayName: member.profiles?.display_name,
            email: member.email ?? member.profiles?.email,
          }),
        })),
      })
    }
    if (os !== 'personal') return emptyPreviewDirectory()
    return buildPreviewDirectory({
      tasks: personalTasks.data?.map((task) => ({
        id: task.id,
        title: task.title,
        project_id: task.project_id,
        projects: task.projects,
      })),
      projects: personalProjects.data?.map((project) => ({ id: project.id, name: project.name })),
    })
  }, [
    isWorkspace,
    os,
    personalProjects.data,
    personalTasks.data,
    workspace.data?.task_key,
    workspaceMembers.data,
    workspaceProjects.data,
    workspaceTasks.data,
  ])
}
