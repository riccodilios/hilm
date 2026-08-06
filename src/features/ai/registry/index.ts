import type { z } from 'zod'
import type {
  ActionContext,
  ActionRisk,
  AiOsMode,
  ParsedRegistryAction,
  RegisteredAction,
} from '@/features/ai/registry/types'
import { normalizeAiAction } from '@/features/ai/registry/schemas'

const registry = new Map<string, RegisteredAction>()

export function registerAction<T extends z.ZodTypeAny>(action: RegisteredAction<T>) {
  registry.set(action.type, action as RegisteredAction)
  return action
}

export function getRegisteredAction(type: string) {
  return registry.get(type)
}

export function listRegisteredActions() {
  return [...registry.values()]
}

export function getActionsForOs(os: AiOsMode, ctx?: ActionContext) {
  return listRegisteredActions().filter((action) => {
    if (action.os !== 'both' && action.os !== os) return false
    if (action.permission && ctx && !action.permission(ctx)) return false
    return true
  })
}

export function buildActionCatalogPrompt(os: AiOsMode, ctx?: ActionContext) {
  const actions = getActionsForOs(os, ctx)
  const lines = actions.map(
    (a) =>
      `- ${a.type} [${a.risk}]: ${a.description}. Fields: ${a.promptFields}`,
  )
  return [
    'When an action would help, finish with a fenced ```actions json block containing a JSON array of action objects.',
    'You may include multiple actions for multi-step workflows; they execute in order.',
    'Prefer executable actions over plain advice. Use UUIDs only when present in context.',
    'Allowed actions:',
    ...lines,
  ].join('\n')
}

export function maxRisk(actions: Array<{ type: string }>): ActionRisk {
  let risk: ActionRisk = 'safe'
  for (const item of actions) {
    const def = registry.get(item.type)
    if (!def) continue
    if (def.risk === 'destructive') return 'destructive'
    if (def.risk === 'confirm') risk = 'confirm'
  }
  return risk
}

export function parseRegistryActions(
  value: unknown,
  os: AiOsMode,
  ctx?: ActionContext,
): ParsedRegistryAction[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { actions?: unknown }).actions)
      ? (value as { actions: unknown[] }).actions
      : null
  if (!list) return []

  const allowed = new Set(getActionsForOs(os, ctx).map((a) => a.type))
  return list.flatMap((item) => {
    const normalized = normalizeAiAction(item)
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return []
    const type = (normalized as { type?: unknown }).type
    if (typeof type !== 'string' || !allowed.has(type)) return []
    const def = registry.get(type)
    if (!def) return []
    const parsed = def.inputSchema.safeParse(normalized)
    return parsed.success ? [parsed.data as ParsedRegistryAction] : []
  })
}

export function extractRegistryActionsFromContent(
  content: string,
  os: AiOsMode,
  ctx?: ActionContext,
) {
  const match = content.match(/```actions(?:\s+json)?\s*\n([\s\S]*?)```/i)
  if (!match) return []
  try {
    return parseRegistryActions(JSON.parse(match[1].trim()), os, ctx)
  } catch {
    return []
  }
}
