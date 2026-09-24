/**
 * Optional voice adapter contract for AI features.
 * Production dictation uses `useSpeechDictation` (Web Speech API) shared across
 * AI Chat and task description fields — do not reimplement recognition here.
 */
export type VoiceInputAdapter = {
  start: () => Promise<void>
  stop: () => Promise<void>
  onTranscript: (listener: (transcript: string, isFinal: boolean) => void) => () => void
}

export const noopVoiceInputAdapter: VoiceInputAdapter = {
  async start() {},
  async stop() {},
  onTranscript() {
    return () => {}
  },
}

