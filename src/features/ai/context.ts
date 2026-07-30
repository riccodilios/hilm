export type AiOsContext =
  | { mode: 'personal'; projectId?: string }
  | { mode: 'workspace'; workspaceId: string; projectId?: string }

export function isWorkspaceAiContext(
  context: AiOsContext | undefined,
): context is Extract<AiOsContext, { mode: 'workspace' }> {
  return context?.mode === 'workspace'
}
