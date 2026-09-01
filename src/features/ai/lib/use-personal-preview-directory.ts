import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  buildPreviewDirectory,
  emptyPreviewDirectory,
  type PreviewDirectory,
} from '@/features/ai/lib/action-preview'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { listTasks, tasksKeys } from '@/features/tasks/api'

export function usePersonalPreviewDirectory(enabled = true): PreviewDirectory {
  const personalProjects = useQuery({
    queryKey: projectsKeys.list(),
    queryFn: listProjects,
    enabled,
    staleTime: 60_000,
  })
  const personalTasks = useQuery({
    queryKey: tasksKeys.list(),
    queryFn: () => listTasks(),
    enabled,
    staleTime: 30_000,
  })

  return useMemo(() => {
    return buildPreviewDirectory({
      tasks: personalTasks.data?.map((task) => ({
        id: task.id,
        title: task.title,
        project_id: task.project_id,
        projects: task.projects,
      })),
      projects: personalProjects.data?.map((project) => ({ id: project.id, name: project.name })),
    })
  }, [personalProjects.data, personalTasks.data])
}

export function usePersonalPreviewDirectoryOptional(
  os: 'personal' | 'workspace' | undefined,
  enabled: boolean,
): PreviewDirectory {
  const directory = usePersonalPreviewDirectory(enabled && os === 'personal')
  if (os !== 'personal') return emptyPreviewDirectory()
  return directory
}
