import type { Database } from '@/types/database'

export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'waiting'
  | 'testing'
  | 'done'
  | 'archived'

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent'
export type HealthStatus =
  | 'unengaged'
  | 'started'
  | 'active'
  | 'healthy'
  | 'near_completion'
  | 'blocked'
  | 'stalled'
  | 'warning'
  | 'critical'
export type RoadmapHorizon = 'now' | 'next' | 'later' | 'future'
export type IdeaStatus = 'inbox' | 'exploring' | 'accepted' | 'rejected' | 'converted'

export type WorkspaceRole = Database['public']['Enums']['workspace_role']
export type StartupMode = Database['public']['Enums']['startup_mode']

export const TASK_STATUSES: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'waiting',
  'testing',
  'done',
  'archived',
]

/** Non-done, non-archived statuses — what the Tasks "Open" filter means. */
export const OPEN_TASK_STATUSES: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'waiting',
  'testing',
]

export const KANBAN_COLUMNS: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'waiting',
  'testing',
  'done',
]

export const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high', 'urgent']

export const ROADMAP_HORIZONS: RoadmapHorizon[] = ['now', 'next', 'later', 'future']

export const PROJECT_COLORS = [
  '#60a5fa',
  '#38bdf8',
  '#2dd4bf',
  '#34d399',
  '#a3e635',
  '#fbbf24',
  '#facc15',
  '#fb923c',
  '#f87171',
  '#fb7185',
  '#f472b6',
  '#a78bfa',
  '#c084fc',
  '#818cf8',
  '#94a3b8',
  '#e4e4e7',
] as const
