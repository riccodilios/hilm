import type { z } from 'zod'
import type { ConversationEntityFocus } from '@/features/ai/lib/conversation-focus'
import type { WorkspaceRole } from '@/types/domain'

export type AiOsMode = 'personal' | 'workspace'

export type ActionRisk = 'safe' | 'confirm' | 'destructive'

export type ActionResult = {
  ok: boolean
  summary: string
  data?: unknown
  entities?: Array<{ type: string; id: string }>
}

export type ActionContext = {
  os: AiOsMode
  workspaceId?: string
  role?: WorkspaceRole | null
  userId?: string
  conversationFocus?: ConversationEntityFocus | null
}

export type RegisteredAction<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  type: string
  os: AiOsMode | 'both'
  title: string
  description: string
  risk: ActionRisk
  parallelSafe?: boolean
  permission?: (ctx: ActionContext) => boolean
  inputSchema: TSchema
  promptFields: string
  execute: (input: z.infer<TSchema>, ctx: ActionContext) => Promise<ActionResult>
}

export type ParsedRegistryAction = {
  type: string
  [key: string]: unknown
}
