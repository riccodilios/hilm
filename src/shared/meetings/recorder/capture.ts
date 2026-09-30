import { createDownsampler, mixToMono, rmsLevel } from './wav-encoder'

/** How audio is captured for a meeting session. */
export type CaptureMode = 'mic' | 'meeting'

export type CaptureErrorCode =
  | 'unsupported'
  | 'insecure'
  | 'permission_denied'
  | 'no_microphone'
  | 'mic_busy'
  | 'display_unsupported'
  | 'display_permission_denied'
  | 'display_cancelled'
  | 'display_no_audio'
  | 'display_ended'
  | 'unknown'

export class CaptureError extends Error {
  readonly code: CaptureErrorCode
  constructor(code: CaptureErrorCode, message?: string) {
    super(message ?? code)
    this.code = code
  }
}

export type CaptureInterruption = 'device_lost' | 'suspended' | 'display_ended'

type CaptureHandlers = {
  onPcm: (pcm: Int16Array) => void
  onLevel: (level: number) => void
  onInterrupted: (reason: CaptureInterruption) => void
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

export function isMicCaptureSupported() {
  if (typeof window === 'undefined') return false
  const hasContext = Boolean(window.AudioContext || (window as WebkitWindow).webkitAudioContext)
  return Boolean(navigator.mediaDevices?.getUserMedia) && hasContext
}

/** True when the browser exposes getDisplayMedia (tab/window share). Audio tracks are still verified after share. */
export function isDisplayAudioCaptureSupported() {
  if (typeof window === 'undefined' || window.isSecureContext === false) return false
  return Boolean(navigator.mediaDevices?.getDisplayMedia) && isMicCaptureSupported()
}

/** Mic-capable browsers can always do IRL recording. */
export function isRecordingSupported() {
  return isMicCaptureSupported()
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

export function mapGetDisplayMediaError(error: unknown): CaptureError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new CaptureError('display_permission_denied')
  }
  if (name === 'AbortError' || name === 'NotFoundError') {
    return new CaptureError('display_cancelled')
  }
  if (name === 'NotSupportedError' || name === 'TypeError') {
    return new CaptureError('display_unsupported')
  }
  return new CaptureError('unknown', error instanceof Error ? error.message : undefined)
}

async function openMicrophoneStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  })
}

/**
 * Ask the user to share a tab/window with audio. Video is requested because most
 * browsers require it to show the picker; video tracks are stopped immediately.
 */
async function openDisplayAudioStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new CaptureError('display_unsupported')
  }
    let raw: MediaStream
  try {
    // video:true is required by most browsers to show the share picker; stopped immediately after.
    raw = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    })
  } catch (error) {
    throw mapGetDisplayMediaError(error)
  }

  for (const track of raw.getVideoTracks()) {
    track.stop()
    raw.removeTrack(track)
  }

  const liveAudio = raw.getAudioTracks().filter((track) => track.readyState === 'live')
  if (!liveAudio.length) {
    raw.getTracks().forEach((track) => track.stop())
    throw new CaptureError('display_no_audio')
  }

  // Rebuild a clean audio-only stream.
  const audioOnly = new MediaStream(liveAudio)
  return audioOnly
}

/**
 * Raw PCM capture → 16 kHz mono. Modes:
 * - mic: microphone only (IRL)
 * - meeting: microphone + shared tab/window audio mixed in AudioContext
 */
export class PcmCapture {
  private micStream: MediaStream | null = null
  private displayStream: MediaStream | null = null
  private context: AudioContext | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private displaySource: MediaStreamAudioSourceNode | null = null
  private mixer: GainNode | null = null
  private processor: ScriptProcessorNode | null = null
  private sink: GainNode | null = null
  private downsample: ((input: Float32Array) => Int16Array) | null = null
  private paused = false
  private stopped = false
  private mode: CaptureMode = 'mic'

  private readonly handlers: CaptureHandlers

  constructor(handlers: CaptureHandlers) {
    this.handlers = handlers
  }

  get captureMode() {
    return this.mode
  }

  get isAlive() {
    const micLive = Boolean(this.micStream?.getAudioTracks().some((track) => track.readyState === 'live'))
    if (this.mode === 'meeting') {
      const displayLive = Boolean(
        this.displayStream?.getAudioTracks().some((track) => track.readyState === 'live'),
      )
      return micLive && displayLive && Boolean(this.context && this.context.state !== 'closed')
    }
    return micLive && Boolean(this.context && this.context.state !== 'closed')
  }

  get contextState() {
    return this.context?.state ?? 'closed'
  }

  async start(mode: CaptureMode = 'mic') {
    if (typeof window !== 'undefined' && window.isSecureContext === false) throw new CaptureError('insecure')
    if (!isMicCaptureSupported()) throw new CaptureError('unsupported')
    this.mode = mode
    this.stopped = false
    this.paused = false

    if (mode === 'meeting') {
      if (!isDisplayAudioCaptureSupported()) throw new CaptureError('display_unsupported')
      // Display share first so a cancel never leaves the mic open unused.
      this.displayStream = await openDisplayAudioStream()
    }

    try {
      this.micStream = await openMicrophoneStream()
    } catch (error) {
      this.displayStream?.getTracks().forEach((track) => track.stop())
      this.displayStream = null
      throw mapGetUserMediaError(error)
    }

    const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext!
    const context = new Ctor()
    this.context = context
    if (context.state === 'suspended') await context.resume().catch(() => undefined)

    this.downsample = createDownsampler(context.sampleRate)
    this.micSource = context.createMediaStreamSource(this.micStream)
    // Sum mic (+ optional display) into one node; Web Audio mixes parallel connections.
    this.mixer = context.createGain()
    this.mixer.gain.value = 1
    this.micSource.connect(this.mixer)

    if (mode === 'meeting' && this.displayStream) {
      this.displaySource = context.createMediaStreamSource(this.displayStream)
      this.displaySource.connect(this.mixer)
    }

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

    this.mixer.connect(this.processor)
    this.processor.connect(this.sink)
    this.sink.connect(context.destination)

    for (const track of this.micStream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (!this.stopped) this.handlers.onInterrupted('device_lost')
      })
    }
    if (this.displayStream) {
      for (const track of this.displayStream.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (!this.stopped) this.handlers.onInterrupted('display_ended')
        })
      }
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
    this.micSource?.disconnect()
    this.displaySource?.disconnect()
    this.mixer?.disconnect()
    this.sink?.disconnect()
    if (this.processor) this.processor.onaudioprocess = null
    this.micStream?.getTracks().forEach((track) => track.stop())
    this.displayStream?.getTracks().forEach((track) => track.stop())
    await this.context?.close().catch(() => undefined)
    this.micStream = null
    this.displayStream = null
    this.context = null
    this.processor = null
    this.micSource = null
    this.displaySource = null
    this.mixer = null
    this.sink = null
  }
}
