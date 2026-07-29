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

export const TASK_STATUSES: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'waiting',
  'testing',
  'done',
  'archived',
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
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#e4e4e7',
] as const
