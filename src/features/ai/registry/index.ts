import type { z } from 'zod'
import type {
  ActionContext,
  ActionRisk,
  AiOsMode,
  ParsedRegistryAction,
  RegisteredAction,
} from '@/features/ai/registry/types'
import { normalizeAiAction } from '@/features/ai/registry/schemas'
import { parseActionsFromAssistantContent } from '@/features/ai/lib/actions-parse'

const registry = new Map<string, RegisteredAction>()

function keyFor(os: AiOsMode, type: string) {
  return `${os}:${type}`
}

export function registerAction<T extends z.ZodTypeAny>(action: RegisteredAction<T>) {
  const typed = action as RegisteredAction
  if (action.os === 'both') {
    registry.set(keyFor('personal', action.type), typed)
    registry.set(keyFor('workspace', action.type), typed)
  } else {
    registry.set(keyFor(action.os, action.type), typed)
  }
  return action
}

export function getRegisteredAction(type: string, os?: AiOsMode) {
  if (os) return registry.get(keyFor(os, type))
  return registry.get(keyFor('personal', type)) ?? registry.get(keyFor('workspace', type))
}

export function listRegisteredActions(os?: AiOsMode) {
  if (!os) {
    const byKey = new Map<string, RegisteredAction>()
    for (const action of registry.values()) {
      byKey.set(`${action.os}:${action.type}`, action)
    }
    return [...byKey.values()]
  }
  const seen = new Set<string>()
  const out: RegisteredAction[] = []
  for (const [key, action] of registry) {
    if (!key.startsWith(`${os}:`)) continue
    if (seen.has(action.type)) continue
    seen.add(action.type)
    out.push(action)
  }
  return out
}

export function getActionsForOs(os: AiOsMode, ctx?: ActionContext) {
  return listRegisteredActions(os).filter((action) => {
    // Only enforce role gates when a role is known; missing role must not hide tools from parse/UI.
    if (action.permission && ctx?.role != null && !action.permission(ctx)) return false
    return true
  })
}

export function buildActionCatalogPrompt(os: AiOsMode, ctx?: ActionContext) {
  const actions = getActionsForOs(os, ctx)
  const lines = actions.map(
    (a) => `- ${a.type} [${a.risk}]: ${a.description}. Fields: ${a.promptFields}`,
  )
  return [
    'When an action would help, finish with a fenced ```actions json block containing a JSON array of action objects.',
    'You may include multiple actions for multi-step workflows; they execute in order.',
    'Prefer executable actions over plain advice. Use UUIDs only when present in context.',
    'Allowed actions:',
    ...lines,
  ].join('\n')
}

export function maxRisk(actions: Array<{ type: string }>, os?: AiOsMode): ActionRisk {
  let risk: ActionRisk = 'safe'
  for (const item of actions) {
    const def = getRegisteredAction(item.type, os)
    if (!def) continue
    if (def.risk === 'destructive') return 'destructive'
    if (def.risk === 'confirm') risk = 'confirm'
  }
  return risk
}

/** Keep raw action objects for streaming UI even when schema validation is strict. */
export function coerceActionsList(value: unknown): ParsedRegistryAction[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { actions?: unknown }).actions)
      ? (value as { actions: unknown[] }).actions
      : null
  if (!list) return []
  return list.flatMap((item) => {
    const normalized = normalizeAiAction(item)
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return []
    const type = (normalized as { type?: unknown }).type
    if (typeof type !== 'string' || !type.trim()) return []
    return [normalized as ParsedRegistryAction]
  })
}

export function parseRegistryActions(
  value: unknown,
  os: AiOsMode,
  ctx?: ActionContext,
): ParsedRegistryAction[] {
  const list = coerceActionsList(value)
  if (!list.length) return []

  const allowed = new Set(getActionsForOs(os, ctx).map((a) => a.type))
  return list.flatMap((item) => {
    const type = String(item.type)
    if (!allowed.has(type)) return []
    const def = getRegisteredAction(type, os)
    if (!def) return []
    const parsed = def.inputSchema.safeParse(item)
    return parsed.success ? [parsed.data as ParsedRegistryAction] : []
  })
}

export function extractRegistryActionsFromContent(
  content: string,
  os: AiOsMode,
  ctx?: ActionContext,
) {
  const parsed = parseActionsFromAssistantContent(content)
  if (!parsed.actions.length) return []
  return parseRegistryActions(parsed.actions, os, ctx)
}
