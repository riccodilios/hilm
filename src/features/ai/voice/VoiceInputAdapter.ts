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
