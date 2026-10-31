import type { WorkspaceRole } from '@/features/workspace-os/lib/permissions'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * A person's position in the workspace, e.g. "Admin · Head of HR", "Design lead", "HR".
 * Built from the org chart: departments they head, teams they lead, else their home department.
 */
export function memberPosition(
  input: {
    userId: string
    role: WorkspaceRole
    departments: { id: string; name: string; head_user_id: string | null }[]
    teams: { name: string; lead_user_id: string | null }[]
    homeDepartmentId: string | null
  },
  t: Translate,
): string {
  const parts: string[] = []
  if (input.role === 'owner' || input.role === 'admin') {
    parts.push(t(`workspace.roles.${input.role}`))
  }
  const headed = input.departments.filter((dept) => dept.head_user_id === input.userId)
  const led = input.teams.filter((team) => team.lead_user_id === input.userId)
  for (const dept of headed) parts.push(t('workspace.positionHead', { department: dept.name }))
  for (const team of led) parts.push(t('workspace.positionLead', { team: team.name }))
  if (!headed.length && !led.length && input.homeDepartmentId) {
    const home = input.departments.find((dept) => dept.id === input.homeDepartmentId)
    if (home) parts.push(home.name)
  }
  if (!parts.length) parts.push(t(`workspace.roles.${input.role}`))
  return parts.join(' · ')
}
