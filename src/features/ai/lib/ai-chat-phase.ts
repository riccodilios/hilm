import type { ThinkingOrbState } from '@/features/ai/components/AiThinkingOrbs'

export type AiChatPhase =
  | 'idle'
  | 'thinking'
  | 'planning'
  | 'streaming'
  | 'awaiting_apply'
  | 'executing'
  | 'finalizing'
  | 'error'

export function phaseToOrbState(phase: AiChatPhase): ThinkingOrbState {
  switch (phase) {
    case 'idle':
      return 'idle'
    case 'thinking':
      return 'thinking'
    case 'planning':
      return 'planning'
    case 'streaming':
      return 'finalizing'
    case 'awaiting_apply':
      return 'complete'
    case 'executing':
      return 'executing'
    case 'finalizing':
      return 'finalizing'
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
}

/** Ambient intensity 0–1 for background reactivity. */
export function phaseAmbientIntensity(phase: AiChatPhase): number {
  switch (phase) {
    case 'idle':
      return 0.35
    case 'thinking':
      return 0.55
    case 'planning':
      return 0.65
    case 'streaming':
      return 0.5
    case 'awaiting_apply':
      return 0.4
    case 'executing':
      return 0.85
    case 'finalizing':
      return 0.45
    case 'error':
      return 0.3
    default:
      return 0.35
  }
}

export function deriveAiChatPhase(input: {
  streaming: boolean
  applying: boolean
  hasStreamError: boolean
  draftPending: boolean
  draftHasVisibleContent: boolean
  hasProposedActions: boolean
  actionRunActive: boolean
  actionRunFinalizing: boolean
}): AiChatPhase {
  if (input.hasStreamError && !input.streaming && !input.applying) return 'error'
  if (input.applying || input.actionRunActive) {
    if (input.actionRunFinalizing) return 'finalizing'
    return 'executing'
  }
  if (input.streaming) {
    if (input.draftPending && !input.draftHasVisibleContent) return 'thinking'
    if (!input.draftHasVisibleContent) return 'planning'
    return 'streaming'
  }
  if (input.hasProposedActions) return 'awaiting_apply'
  return 'idle'
}
