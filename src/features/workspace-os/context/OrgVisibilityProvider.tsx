import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  getWorkspaceMemberSettings,
  workspaceKeys,
  type WorkspaceTask,
} from '@/features/workspace-os/api'
import { listDepartments, listTeams, orgKeys } from '@/features/workspace-os/org-api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import {
  resolveVisibleDepartmentIds,
  taskPassesDepartmentFilter,
} from '@/features/workspace-os/lib/org-visibility'

type OrgVisibilityContextValue = {
  homeDepartmentId: string | null
  visibleDepartmentIds: string[]
  selectedDepartmentIds: string[]
  setSelectedDepartmentIds: (ids: string[]) => void
  toggleDepartment: (id: string) => void
  selectAllVisible: () => void
  selectHomeOnly: () => void
  filterTasks: (tasks: WorkspaceTask[]) => WorkspaceTask[]
  leadTeamIds: Set<string>
  canSeeAll: boolean
}

const OrgVisibilityContext = createContext<OrgVisibilityContextValue | null>(null)

export function useOrgVisibility() {
  const ctx = useContext(OrgVisibilityContext)
  if (!ctx) throw new Error('useOrgVisibility must be used inside OrgVisibilityProvider')
  return ctx
}

export function OrgVisibilityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { workspaceId, role } = useWorkspace()
  const storageKey = `hilm:ws-dept-filter:${workspaceId}`

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

  const homeDepartmentId = memberSettings.data?.department_id ?? null
  const canSeeAll = role === 'owner' || role === 'admin'

  const visibleDepartmentIds = useMemo(() => {
    return [
      ...resolveVisibleDepartmentIds({
        role,
        homeDepartmentId,
        departments: departments.data ?? [],
      }),
    ]
  }, [role, homeDepartmentId, departments.data])

  const visibleKey = visibleDepartmentIds.slice().sort().join(',')
  const [selectedDepartmentIds, setSelectedDepartmentIdsState] = useState<string[]>([])

  useEffect(() => {
    if (!visibleDepartmentIds.length) {
      setSelectedDepartmentIdsState([])
      return
    }
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        const next = parsed.filter((id) => visibleDepartmentIds.includes(id))
        if (next.length) {
          setSelectedDepartmentIdsState(next)
          return
        }
      }
    } catch {
      /* ignore */
    }
    if (homeDepartmentId && visibleDepartmentIds.includes(homeDepartmentId)) {
      setSelectedDepartmentIdsState([homeDepartmentId])
    } else {
      setSelectedDepartmentIdsState(visibleDepartmentIds)
    }
  }, [storageKey, visibleKey, homeDepartmentId, visibleDepartmentIds])

  const setSelectedDepartmentIds = useCallback(
    (ids: string[]) => {
      const next = ids.filter((id) => visibleDepartmentIds.includes(id))
      setSelectedDepartmentIdsState(next)
      localStorage.setItem(storageKey, JSON.stringify(next))
    },
    [storageKey, visibleDepartmentIds],
  )

  const toggleDepartment = useCallback(
    (id: string) => {
      if (!visibleDepartmentIds.includes(id)) return
      setSelectedDepartmentIdsState((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        const filtered = next.filter((x) => visibleDepartmentIds.includes(x))
        localStorage.setItem(storageKey, JSON.stringify(filtered))
        return filtered
      })
    },
    [storageKey, visibleDepartmentIds],
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

  const filterTasks = useCallback(
    (tasks: WorkspaceTask[]) => {
      const selected = new Set(selectedDepartmentIds)
      const allVisibleSelected =
        selected.size > 0 &&
        selected.size === visibleDepartmentIds.length &&
        visibleDepartmentIds.every((id) => selected.has(id))

      // Admin + every visible department selected → no further narrowing.
      if (canSeeAll && allVisibleSelected) return tasks

      return tasks.filter((task) =>
        taskPassesDepartmentFilter(task, {
          selectedDepartmentIds: selected,
          userId: user?.id ?? null,
          leadTeamIds,
          // Empty selection: admins still see unscoped tasks (prior behavior).
          // All-visible selected (member): include unscoped within their tree.
          // Partial selection: only tasks in the active department chips.
          includeUnscoped: selected.size === 0 ? canSeeAll : allVisibleSelected,
        }),
      )
    },
    [selectedDepartmentIds, canSeeAll, visibleDepartmentIds, user?.id, leadTeamIds],
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
        leadTeamIds,
        canSeeAll,
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
      leadTeamIds,
      canSeeAll,
    ],
  )

  return (
    <OrgVisibilityContext.Provider value={value}>{children}</OrgVisibilityContext.Provider>
  )
}
