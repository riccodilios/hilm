import { createDownsampler, mixToMono, rmsLevel } from './wav-encoder'

export type CaptureErrorCode =
  | 'unsupported'
  | 'insecure'
  | 'permission_denied'
  | 'no_microphone'
  | 'mic_busy'
  | 'unknown'

export class CaptureError extends Error {
  readonly code: CaptureErrorCode
  constructor(code: CaptureErrorCode, message?: string) {
    super(message ?? code)
    this.code = code
  }
}

export type CaptureInterruption = 'device_lost' | 'suspended'

type CaptureHandlers = {
  onPcm: (pcm: Int16Array) => void
  onLevel: (level: number) => void
  onInterrupted: (reason: CaptureInterruption) => void
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

export function isRecordingSupported() {
  if (typeof window === 'undefined') return false
  const hasContext = Boolean(window.AudioContext || (window as WebkitWindow).webkitAudioContext)
  return Boolean(navigator.mediaDevices?.getUserMedia) && hasContext
}

function mapGetUserMediaError(error: unknown): CaptureError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new CaptureError('permission_denied')
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return new CaptureError('no_microphone')
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new CaptureError('mic_busy')
  }
  return new CaptureError('unknown', error instanceof Error ? error.message : undefined)
}

/**
 * Raw microphone capture → 16 kHz mono PCM. Uses the Web Audio graph directly, so
 * there is no container decoding and pause/resume never creates gaps in timestamps.
 */
export class PcmCapture {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private sink: GainNode | null = null
  private downsample: ((input: Float32Array) => Int16Array) | null = null
  private paused = false
  private stopped = false

  private readonly handlers: CaptureHandlers

  constructor(handlers: CaptureHandlers) {
    this.handlers = handlers
  }

  get isAlive() {
    return Boolean(
      this.stream?.getAudioTracks().some((track) => track.readyState === 'live') &&
        this.context &&
        this.context.state !== 'closed',
    )
  }

  get contextState() {
    return this.context?.state ?? 'closed'
  }

  async start() {
    if (typeof window !== 'undefined' && window.isSecureContext === false) throw new CaptureError('insecure')
    if (!isRecordingSupported()) throw new CaptureError('unsupported')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
    } catch (error) {
      throw mapGetUserMediaError(error)
    }

    const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext!
    const context = new Ctor()
    this.context = context
    if (context.state === 'suspended') await context.resume().catch(() => undefined)

    this.downsample = createDownsampler(context.sampleRate)
    this.source = context.createMediaStreamSource(this.stream)
    this.processor = context.createScriptProcessor(4096, 1, 1)
    this.sink = context.createGain()
    this.sink.gain.value = 0

    this.processor.onaudioprocess = (event) => {
      if (this.paused || this.stopped || !this.downsample) return
      const buffer = event.inputBuffer
      const channels: Float32Array[] = []
      for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c).slice())
      const mono = mixToMono(channels)
      this.handlers.onLevel(rmsLevel(mono))
      const pcm = this.downsample(mono)
      if (pcm.length) this.handlers.onPcm(pcm)
    }

    this.source.connect(this.processor)
    this.processor.connect(this.sink)
    this.sink.connect(context.destination)

    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (!this.stopped) this.handlers.onInterrupted('device_lost')
      })
    }
    context.addEventListener('statechange', () => {
      if (this.stopped || this.paused) return
      if (context.state !== 'running') this.handlers.onInterrupted('suspended')
    })
  }

  pause() {
    this.paused = true
    this.handlers.onLevel(0)
  }

  async resume() {
    this.paused = false
    if (this.context && this.context.state !== 'running') {
      await this.context.resume().catch(() => undefined)
    }
    return this.context?.state === 'running'
  }

  async stop() {
    this.stopped = true
    this.processor?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    if (this.processor) this.processor.onaudioprocess = null
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.context?.close().catch(() => undefined)
    this.stream = null
    this.context = null
    this.processor = null
    this.source = null
    this.sink = null
  }
}
