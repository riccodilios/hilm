import type { ConversationEntityFocus } from '@/features/ai/lib/conversation-focus'
import { getRegisteredAction } from '@/features/ai/registry'
import type { AiAction } from '@/types/ai-actions'

export type PreviewFact = {
  label: string
  value: string
}

export type PreviewDirectory = {
  projects: Record<string, string>
  people: Record<string, string>
  teams: Record<string, string>
  departments: Record<string, string>
  tasks: Record<string, PreviewTaskHint>
}

export type PreviewTaskHint = {
  title: string
  ref?: string
  project?: string
}

export type ProposedActionPreview = {
  key: string
  verb: string
  kind: 'create' | 'update' | 'delete' | 'other'
  title: string
  project?: string
  taskRef?: string
  facts: PreviewFact[]
  changes: PreviewFact[]
  meta: string[]
  change?: string
  description?: string
  risk?: string
}

export type PreviewContext = {
  os?: 'personal' | 'workspace'
  focus?: ConversationEntityFocus | null
  directory?: PreviewDirectory | null
}

const emptyDirectory = (): PreviewDirectory => ({
  projects: {},
  people: {},
  teams: {},
  departments: {},
  tasks: {},
})

export function emptyPreviewDirectory(): PreviewDirectory {
  return emptyDirectory()
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function pick(action: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = asString(action[key])
    if (value) return value
  }
  return undefined
}

/** String, or null when the field is explicitly cleared. Undefined if absent. */
function pickNullable(action: Record<string, unknown>, ...keys: string[]): string | null | undefined {
  for (const key of keys) {
    if (!(key in action)) continue
    const value = action[key]
    if (value === null || value === '') return null
    const text = asString(value)
    if (text) return text
  }
  return undefined
}

function prettyWords(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function prettyDue(value: string) {
  const iso = value.trim()
  if (!iso) return iso
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.length > 16 ? iso.slice(0, 16).replace('T', ' ') : iso
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: iso.includes('T') ? 'numeric' : undefined,
      minute: iso.includes('T') ? '2-digit' : undefined,
    }).format(date)
  } catch {
    return iso
  }
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function looksLikeTaskRef(value: string) {
  return /^[A-Za-z][A-Za-z0-9]{1,11}-\d+$/.test(value.trim())
}

function humanName(value?: string | null) {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed || looksLikeUuid(trimmed)) return undefined
  return trimmed
}

function resolveNamed(
  raw: string | undefined,
  map: Record<string, string>,
) {
  if (!raw) return undefined
  if (map[raw]) return map[raw]
  const lower = raw.toLowerCase()
  const match = Object.entries(map).find(([id]) => id.toLowerCase() === lower)
  if (match) return match[1]
  return humanName(raw)
}

function verbForType(type: string, defTitle?: string) {
  const map: Record<string, string> = {
    'task.create': 'Create task',
    'task.create_many': 'Create task',
    'task.update': 'Update task',
    'task.schedule': 'Reschedule task',
    'task.assign': 'Assign task',
    'task.move': 'Move task',
    'task.complete': 'Complete task',
    'task.delete': 'Delete task',
    'task.archive': 'Archive task',
    'project.create': 'Create project',
    'project.update': 'Update project',
    'project.delete': 'Delete project',
    'comment.create': 'Add comment',
    'label.create': 'Create label',
    'label.assign': 'Set labels',
    'label.apply_named': 'Set labels',
    'subtask.create': 'Add subtask',
    'note.create': 'Create note',
    'idea.create': 'Capture idea',
  }
  return map[type] || defTitle || type.replace(/\./g, ' ')
}

function kindForType(type: string): ProposedActionPreview['kind'] {
  if (type.includes('delete') || type.includes('archive')) return 'delete'
  if (
    type.includes('update') ||
    type.includes('assign') ||
    type.includes('schedule') ||
    type.includes('move') ||
    type.includes('complete') ||
    type.includes('comment')
  ) {
    return 'update'
  }
  if (type.includes('create')) return 'create'
  return 'other'
}

function snippet(value?: string, max = 140) {
  if (!value) return undefined
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1).trimEnd()}…`
}

function labelsFrom(action: Record<string, unknown>) {
  const named = pick(action, 'labelName', 'label_name')
  if (named) return named
  const names = action.labelNames ?? action.labels
  if (Array.isArray(names)) {
    const text = names.map((item) => asString(item)).filter(Boolean).join(', ')
    return text || undefined
  }
  return undefined
}

function lookupTask(directory: PreviewDirectory, taskId?: string) {
  if (!taskId) return undefined
  return directory.tasks[taskId] || directory.tasks[taskId.toLowerCase()]
}

function parentProject(
  action: Record<string, unknown>,
  focus: ConversationEntityFocus | null | undefined,
  directory: PreviewDirectory,
) {
  const named = pick(action, 'projectName', 'project_name')
  if (named && !looksLikeUuid(named)) return named
  const fromId = resolveNamed(pick(action, 'projectId', 'project_id'), directory.projects)
  if (fromId) return fromId
  return humanName(focus?.lastReferencedProjectName)
}

function taskIdentity(
  action: Record<string, unknown>,
  focus: ConversationEntityFocus | null | undefined,
  directory: PreviewDirectory,
  isMutation: boolean,
): { title: string; taskRef?: string; nextTitle?: string; project?: string } {
  const proposedTitle = pick(action, 'title', 'name')
  const taskId = pick(action, 'taskId', 'task_id')
  const hinted = lookupTask(directory, taskId)
  const existingRef =
    (taskId && looksLikeTaskRef(taskId) ? taskId : undefined) ||
    hinted?.ref ||
    (focus?.lastTaskRef && !looksLikeUuid(focus.lastTaskRef) ? focus.lastTaskRef : undefined)
  const existingTitle = hinted?.title || humanName(focus?.lastTaskTitle)

  if (isMutation) {
    const title =
      existingTitle ||
      existingRef ||
      (proposedTitle && !looksLikeUuid(proposedTitle) ? proposedTitle : undefined) ||
      'This task'
    return {
      title,
      taskRef: existingRef,
      nextTitle: proposedTitle && proposedTitle !== title && !looksLikeUuid(proposedTitle) ? proposedTitle : undefined,
      project: hinted?.project,
    }
  }

  if (proposedTitle && !looksLikeUuid(proposedTitle)) {
    return {
      title: proposedTitle,
      taskRef: existingRef && existingRef !== proposedTitle ? existingRef : undefined,
      project: hinted?.project,
    }
  }
  if (existingRef) return { title: existingRef, taskRef: existingRef, project: hinted?.project }
  if (existingTitle) return { title: existingTitle, taskRef: existingRef, project: hinted?.project }
  return { title: 'This task', project: hinted?.project }
}

function fieldFacts(action: Record<string, unknown>, directory: PreviewDirectory) {
  const priority = pick(action, 'priority')
  const status = pick(action, 'status')
  const dueAt = pickNullable(action, 'dueAt', 'due_at', 'dueDate', 'due_date')
  const assignee =
    pick(action, 'assigneeName', 'assignee_name') ||
    resolveNamed(pick(action, 'assigneeId', 'assignee_id'), directory.people)
  const team =
    pick(action, 'teamName', 'team_name') ||
    resolveNamed(pick(action, 'teamId', 'team_id'), directory.teams)
  const department =
    pick(action, 'departmentName', 'department_name') ||
    resolveNamed(pick(action, 'departmentId', 'department_id'), directory.departments)
  const labels = labelsFrom(action)

  const facts: PreviewFact[] = []
  if (priority) facts.push({ label: 'Priority', value: prettyWords(priority) })
  if (status) facts.push({ label: 'Status', value: prettyWords(status) })
  if (dueAt) facts.push({ label: 'Due', value: prettyDue(dueAt) })
  if (dueAt === null) facts.push({ label: 'Due', value: 'Cleared' })
  if (assignee) facts.push({ label: 'Assignee', value: assignee })
  if (team) facts.push({ label: 'Team', value: team })
  if (department) facts.push({ label: 'Department', value: department })
  if (labels) facts.push({ label: 'Labels', value: labels })
  return facts
}

function previewFromFields(
  action: Record<string, unknown>,
  opts: {
    key: string
    type: string
    verb: string
    title: string
    project?: string
    taskRef?: string
    risk?: string
    nextTitle?: string
    kind?: ProposedActionPreview['kind']
    extraDescription?: string
    directory: PreviewDirectory
  },
): ProposedActionPreview {
  const description = snippet(
    opts.extraDescription || pick(action, 'description', 'content', 'body', 'summary'),
  )
  const kind = opts.kind ?? kindForType(opts.type)
  const facts = fieldFacts(action, opts.directory)
  const isChange = kind === 'update' || kind === 'delete'
  const changes: PreviewFact[] = []
  if (isChange) {
    if (opts.nextTitle) changes.push({ label: 'Title', value: opts.nextTitle })
    changes.push(...facts)
    if (kind === 'delete') changes.push({ label: 'Action', value: opts.verb })
    else if (opts.type === 'task.complete' && !facts.some((fact) => fact.label === 'Status')) {
      changes.push({ label: 'Status', value: 'Done' })
    } else if (description && opts.type.includes('update') && opts.type !== 'comment.create') {
      changes.push({ label: 'Description', value: 'Updated' })
    }
  }

  const displayFacts = isChange ? [] : facts
  const change = changes.length
    ? changes.map((fact) => `${fact.label} → ${fact.value}`).join(' · ')
    : undefined

  return {
    key: opts.key,
    verb: opts.verb,
    kind,
    title: opts.title,
    project: opts.project,
    taskRef: opts.taskRef,
    facts: displayFacts,
    changes,
    meta: displayFacts.map((fact) => `${fact.label} ${fact.value}`),
    change,
    description: isChange && opts.type !== 'comment.create' ? undefined : description,
    risk: opts.risk,
  }
}

export function describeProposedActions(
  actions: AiAction[],
  ctx: PreviewContext = {},
): ProposedActionPreview[] {
  const rows: ProposedActionPreview[] = []
  const directory = ctx.directory ?? emptyDirectory()

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index] as Record<string, unknown>
    const type = asString(action.type) || 'unknown'
    const def = getRegisteredAction(type, ctx.os)
    const risk = def?.risk && def.risk !== 'safe' ? def.risk : undefined
    const verb = verbForType(type, def?.title)
    const inheritedProject = parentProject(action, ctx.focus, directory)

    if (type === 'task.create_many' && Array.isArray(action.items)) {
      for (let itemIndex = 0; itemIndex < action.items.length; itemIndex++) {
        const raw = action.items[itemIndex]
        const item =
          raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : { title: `Task ${itemIndex + 1}` }
        const title = pick(item, 'title') || `Task ${itemIndex + 1}`
        const itemProject = parentProject({ ...action, ...item }, ctx.focus, directory) || inheritedProject
        rows.push(
          previewFromFields(item, {
            key: `${index}-create-many-${itemIndex}`,
            type: 'task.create',
            verb: 'Create task',
            title,
            project: itemProject,
            risk,
            directory,
          }),
        )
      }
      continue
    }

    if (type === 'project.create') {
      rows.push({
        key: `${type}-${index}`,
        verb,
        kind: 'create',
        title: pick(action, 'name') || 'New project',
        project: pick(action, 'name'),
        facts: [],
        changes: [],
        meta: [],
        description: snippet(pick(action, 'description')),
        risk,
      })
      continue
    }

    const kind = kindForType(type)
    const identifyExistingTask =
      type.startsWith('task.') || type === 'comment.create' || type === 'subtask.create'
    const isMutation = identifyExistingTask && (kind === 'update' || kind === 'delete')

    const identity = taskIdentity(action, ctx.focus, directory, isMutation)
    const project =
      type.startsWith('project.')
        ? pick(action, 'name') || inheritedProject
        : inheritedProject || identity.project

    rows.push(
      previewFromFields(action, {
        key: `${type}-${index}`,
        type,
        verb,
        kind: kindForType(type),
        title: type.startsWith('project.') ? pick(action, 'name') || identity.title : identity.title,
        project: project && project !== identity.title ? project : identity.project,
        taskRef: type.startsWith('task.') || type === 'comment.create' || type === 'subtask.create' ? identity.taskRef : undefined,
        risk,
        nextTitle: identity.nextTitle,
        extraDescription: type === 'comment.create' ? pick(action, 'content', 'body', 'comment') : undefined,
        directory,
      }),
    )
  }

  return rows
}

export function previewHeadline(preview: ProposedActionPreview) {
  return preview.taskRef && preview.taskRef !== preview.title
    ? `${preview.taskRef} · ${preview.title}`
    : preview.title
}

export function previewDetail(preview: ProposedActionPreview) {
  const parts = [
    preview.project ? `Project ${preview.project}` : undefined,
    ...preview.facts.map((fact) => `${fact.label} ${fact.value}`),
    preview.change,
  ]
  return parts.filter(Boolean).join(' · ') || undefined
}

type DirectoryTaskInput = {
  id: string
  title?: string | null
  task_number?: number | null
  project_id?: string | null
  workspace_projects?: { id?: string; name?: string | null } | null
  projects?: { id?: string; name?: string | null } | null
  assignee?: { id?: string | null; display_name?: string | null } | null
  assignee_id?: string | null
}

export function buildPreviewDirectory(input: {
  taskKey?: string | null
  tasks?: DirectoryTaskInput[]
  projects?: Array<{ id: string; name: string }>
  people?: Array<{ id: string; name: string }>
  teams?: Array<{ id: string; name: string }>
  departments?: Array<{ id: string; name: string }>
}): PreviewDirectory {
  const directory = emptyDirectory()
  for (const project of input.projects ?? []) {
    if (project.id && project.name) directory.projects[project.id] = project.name
  }
  for (const person of input.people ?? []) {
    if (person.id && person.name && !looksLikeUuid(person.name)) directory.people[person.id] = person.name
  }
  for (const team of input.teams ?? []) {
    if (team.id && team.name) directory.teams[team.id] = team.name
  }
  for (const department of input.departments ?? []) {
    if (department.id && department.name) directory.departments[department.id] = department.name
  }

  for (const task of input.tasks ?? []) {
    const projectName =
      humanName(task.workspace_projects?.name) ||
      humanName(task.projects?.name) ||
      (task.project_id ? directory.projects[task.project_id] : undefined)
    const projectId = task.workspace_projects?.id || task.projects?.id || task.project_id
    if (projectId && projectName) directory.projects[projectId] = projectName
    const assigneeId = task.assignee?.id || task.assignee_id
    const assigneeName = humanName(task.assignee?.display_name)
    if (assigneeId && assigneeName) directory.people[assigneeId] = assigneeName

    const ref =
      input.taskKey && task.task_number != null
        ? `${input.taskKey}-${task.task_number}`
        : undefined
    const title = humanName(task.title) || ref || 'Task'
    const hint: PreviewTaskHint = { title, ref, project: projectName }
    directory.tasks[task.id] = hint
    if (ref) {
      directory.tasks[ref] = hint
      directory.tasks[ref.toLowerCase()] = hint
    }
  }

  return directory
}
