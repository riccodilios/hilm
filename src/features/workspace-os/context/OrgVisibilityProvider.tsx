import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  getWorkspaceMemberSettings,
  listAllMemberSettings,
  workspaceKeys,
  type WorkspaceProject,
  type WorkspaceTask,
} from '@/features/workspace-os/api'
import { listDepartments, listTeams, orgKeys } from '@/features/workspace-os/org-api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import {
  buildTaskVisibilityScope,
  canSeeMemberWork,
  canSeeWorkspaceTask,
  filterProjectsForScope,
  taskDepartmentId,
} from '@/features/workspace-os/lib/member-visibility'

type OrgVisibilityContextValue = {
  homeDepartmentId: string | null
  /** Departments shown as filter chips: all of them for owners/admins, the headed ones for heads. */
  visibleDepartmentIds: string[]
  selectedDepartmentIds: string[]
  setSelectedDepartmentIds: (ids: string[]) => void
  toggleDepartment: (id: string) => void
  selectAllVisible: () => void
  selectHomeOnly: () => void
  filterTasks: (tasks: WorkspaceTask[]) => WorkspaceTask[]
  filterProjects: <P extends WorkspaceProject>(projects: P[], tasks: WorkspaceTask[]) => P[]
  canSeeTask: (task: WorkspaceTask) => boolean
  canSeeMember: (userId: string) => boolean
  leadTeamIds: Set<string>
  canSeeAll: boolean
  isDepartmentHead: boolean
}

const OrgVisibilityContext = createContext<OrgVisibilityContextValue | null>(null)

export function useOrgVisibility() {
  const ctx = useContext(OrgVisibilityContext)
  if (!ctx) throw new Error('useOrgVisibility must be used inside OrgVisibilityProvider')
  return ctx
}

function readStoredSelection(storageKey: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : null
  } catch {
    return null
  }
}

export function OrgVisibilityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { workspaceId, role } = useWorkspace()
  const storageKey = `hilm:ws-dept-filter:v2:${workspaceId}`

  const departments = useQuery({
    queryKey: orgKeys.departments(workspaceId),
    queryFn: () => listDepartments(workspaceId),
  })
  const teams = useQuery({
    queryKey: orgKeys.teams(workspaceId),
    queryFn: () => listTeams(workspaceId),
  })
  const memberSettings = useQuery({
    queryKey: workspaceKeys.memberSettings(workspaceId),
    queryFn: () => getWorkspaceMemberSettings(workspaceId),
  })
  const allMemberSettings = useQuery({
    queryKey: [...workspaceKeys.all, 'member-settings-all', workspaceId],
    queryFn: () => listAllMemberSettings(workspaceId),
  })

  const homeDepartmentId = memberSettings.data?.department_id ?? null
  const canSeeAll = role === 'owner' || role === 'admin'

  const scope = useMemo(
    () =>
      buildTaskVisibilityScope({
        userId: user?.id,
        role,
        departments: departments.data ?? [],
        teams: teams.data ?? [],
        memberSettings: allMemberSettings.data ?? [],
      }),
    [user?.id, role, departments.data, teams.data, allMemberSettings.data],
  )

  const visibleDepartmentIds = useMemo(
    () =>
      canSeeAll
        ? (departments.data ?? []).map((dept) => dept.id)
        : (departments.data ?? []).filter((dept) => scope.headDepartmentIds.has(dept.id)).map((dept) => dept.id),
    [canSeeAll, departments.data, scope.headDepartmentIds],
  )

  // null = never narrowed: everything in view is selected.
  const [selectionByKey, setSelectionByKey] = useState<Record<string, string[] | null>>({})
  const storedSelection =
    storageKey in selectionByKey ? selectionByKey[storageKey]! : readStoredSelection(storageKey)
  const setStoredSelection = useCallback(
    (ids: string[] | null) => setSelectionByKey((prev) => ({ ...prev, [storageKey]: ids })),
    [storageKey],
  )
  const selectedDepartmentIds = useMemo(() => {
    if (!storedSelection) return visibleDepartmentIds
    return storedSelection.filter((id) => visibleDepartmentIds.includes(id))
  }, [storedSelection, visibleDepartmentIds])

  const setSelectedDepartmentIds = useCallback(
    (ids: string[]) => {
      const next = ids.filter((id) => visibleDepartmentIds.includes(id))
      const all = next.length === visibleDepartmentIds.length
      setStoredSelection(all ? null : next)
      try {
        if (all) localStorage.removeItem(storageKey)
        else localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        /* storage unavailable */
      }
    },
    [setStoredSelection, storageKey, visibleDepartmentIds],
  )

  const toggleDepartment = useCallback(
    (id: string) => {
      if (!visibleDepartmentIds.includes(id)) return
      setSelectedDepartmentIds(
        selectedDepartmentIds.includes(id)
          ? selectedDepartmentIds.filter((x) => x !== id)
          : [...selectedDepartmentIds, id],
      )
    },
    [selectedDepartmentIds, setSelectedDepartmentIds, visibleDepartmentIds],
  )

  const selectAllVisible = useCallback(() => {
    setSelectedDepartmentIds(visibleDepartmentIds)
  }, [setSelectedDepartmentIds, visibleDepartmentIds])

  const selectHomeOnly = useCallback(() => {
    if (homeDepartmentId && visibleDepartmentIds.includes(homeDepartmentId)) {
      setSelectedDepartmentIds([homeDepartmentId])
    }
  }, [homeDepartmentId, setSelectedDepartmentIds, visibleDepartmentIds])

  const leadTeamIds = useMemo(() => {
    return new Set(
      (teams.data ?? [])
        .filter((team) => team.lead_user_id === user?.id)
        .map((team) => team.id),
    )
  }, [teams.data, user?.id])

  const canSeeTask = useCallback((task: WorkspaceTask) => canSeeWorkspaceTask(task, scope), [scope])
  const canSeeMember = useCallback((userId: string) => canSeeMemberWork(userId, scope), [scope])

  const filterTasks = useCallback(
    (tasks: WorkspaceTask[]) => {
      const scoped = tasks.filter((task) => canSeeWorkspaceTask(task, scope))
      if (!visibleDepartmentIds.length || selectedDepartmentIds.length === visibleDepartmentIds.length) {
        return scoped
      }
      const selected = new Set(selectedDepartmentIds)
      // Department chips narrow other people's work; your own assigned tasks always stay.
      return scoped.filter((task) => {
        if (task.assignee_id && task.assignee_id === scope.userId) return true
        const departmentId = taskDepartmentId(task, scope)
        return departmentId != null && selected.has(departmentId)
      })
    },
    [scope, selectedDepartmentIds, visibleDepartmentIds],
  )

  const filterProjects = useCallback(
    <P extends WorkspaceProject>(projects: P[], tasks: WorkspaceTask[]) =>
      filterProjectsForScope(projects, tasks, scope),
    [scope],
  )

  const value = useMemo(
    () =>
      ({
        homeDepartmentId,
        visibleDepartmentIds,
        selectedDepartmentIds,
        setSelectedDepartmentIds,
        toggleDepartment,
        selectAllVisible,
        selectHomeOnly,
        filterTasks,
        filterProjects,
        canSeeTask,
        canSeeMember,
        leadTeamIds,
        canSeeAll,
        isDepartmentHead: scope.headDepartmentIds.size > 0,
      }) satisfies OrgVisibilityContextValue,
    [
      homeDepartmentId,
      visibleDepartmentIds,
      selectedDepartmentIds,
      setSelectedDepartmentIds,
      toggleDepartment,
      selectAllVisible,
      selectHomeOnly,
      filterTasks,
      filterProjects,
      canSeeTask,
      canSeeMember,
      leadTeamIds,
      canSeeAll,
      scope.headDepartmentIds.size,
    ],
  )

  return (
    <OrgVisibilityContext.Provider value={value}>{children}</OrgVisibilityContext.Provider>
  )
}
