import type { HealthStatus } from '@/types/domain'

/** Minimal project row for Mission Control overview (personal or workspace). */
export type MissionProjectInsight = {
  id: string
  name: string
  color: string | null
  health: HealthStatus
}
