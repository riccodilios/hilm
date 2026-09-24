import { useCallback, useEffect, useRef, useState } from 'react'
import {
  composeVoiceFieldValue,
  mergeRecognitionIntoSession,
  rebuildRecognitionTranscript,
  type SpeechLocale,
} from '@/lib/voice-transcript'

type SpeechRecognitionAlternativeLike = {
  transcript: string
  confidence: number
}

type SpeechRecognitionResultLike = {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export type SpeechTranscriptState = {
  /** Finalized text for the current mic session (across keep-alive restarts). */
  committed: string
  /** Current non-final hypothesis — never permanently append this. */
  interim: string
}

export type SpeechFinalPayload = {
  transcript: string
  confidence: number
  gapMs: number
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isSpeechDictationSupported() {
  return Boolean(getSpeechRecognitionCtor())
}

function voiceDebug(message: string, payload?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return
  if (payload) console.debug(`[hilm:voice] ${message}`, payload)
  else console.debug(`[hilm:voice] ${message}`)
}

/**
 * Shared Web Speech dictation for AI Chat, task descriptions, etc.
 *
 * Lifecycle (critical for mobile Safari / PWA):
 * - Rebuild committed+interim from the full `event.results` list every time
 * - Never `transcript += interim`
 * - Keep-alive restarts freeze committed text into a session anchor so
 *   re-delivered finals are not appended again
 */
export function useSpeechDictation(opts: {
  lang?: SpeechLocale | string
  /** When true, recognition restarts after silence so the user can keep talking. */
  keepAlive?: boolean
  /**
   * Preferred API: full session snapshot. Compose the field with
   * `composeVoiceFieldValue(baseAtStart, committed, interim)`.
   */
  onTranscript?: (state: SpeechTranscriptState) => void
  /**
   * @deprecated Prefer onTranscript. Fires only when session committed text grows
   * with the delta (not evolving interim prefixes).
   */
  onFinal?: (transcript: string, meta: SpeechFinalPayload) => void
  onError?: (message: string) => void
}) {
  const [listening, setListening] = useState(false)
  const [committed, setCommitted] = useState('')
  const [interim, setInterim] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onTranscriptRef = useRef(opts.onTranscript)
  const onFinalRef = useRef(opts.onFinal)
  const onErrorRef = useRef(opts.onError)
  const keepAliveRef = useRef(Boolean(opts.keepAlive))
  const intentionalStopRef = useRef(false)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionIdRef = useRef(0)
  /** Text committed before the current recognition instance (keep-alive). */
  const sessionAnchorRef = useRef('')
  /** Rebuilt finals for the current recognition instance only. */
  const recognitionCommittedRef = useRef('')
  const lastEmittedCommittedRef = useRef('')
  const lastFinalAtRef = useRef(0)
  const supported = isSpeechDictationSupported()

  useEffect(() => {
    onTranscriptRef.current = opts.onTranscript
  }, [opts.onTranscript])

  useEffect(() => {
    onFinalRef.current = opts.onFinal
  }, [opts.onFinal])

  useEffect(() => {
    onErrorRef.current = opts.onError
  }, [opts.onError])

  useEffect(() => {
    keepAliveRef.current = Boolean(opts.keepAlive)
  }, [opts.keepAlive])

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }, [])

  const emitTranscript = useCallback((nextCommitted: string, nextInterim: string) => {
    setCommitted(nextCommitted)
    setInterim(nextInterim)
    onTranscriptRef.current?.({ committed: nextCommitted, interim: nextInterim })

    const prev = lastEmittedCommittedRef.current
    const prevNorm = prev.replace(/\s+/g, ' ').trim().toLowerCase()
    const nextNorm = nextCommitted.replace(/\s+/g, ' ').trim().toLowerCase()
    if (!nextNorm || nextNorm === prevNorm) return

    // Only notify onFinal when committed grew (delta), never for interim.
    let delta = nextCommitted
    if (prev && nextNorm.startsWith(prevNorm)) {
      delta = nextCommitted.slice(prev.length).trim()
      // If slice landed mid-word due to spacing diffs, fall back to merge remainder.
      if (!delta) {
        lastEmittedCommittedRef.current = nextCommitted
        return
      }
    } else if (prev && prevNorm.startsWith(nextNorm)) {
      // Shorter revision — do not emit a destructive final; session snapshot handles UI.
      lastEmittedCommittedRef.current = nextCommitted
      return
    }

    const now = Date.now()
    const gapMs = lastFinalAtRef.current ? now - lastFinalAtRef.current : 0
    lastFinalAtRef.current = now
    lastEmittedCommittedRef.current = nextCommitted
    if (delta) {
      onFinalRef.current?.(delta, {
        transcript: delta,
        confidence: 1,
        gapMs,
      })
    }
  }, [])

  const freezeRecognitionIntoAnchor = useCallback(() => {
    const merged = mergeRecognitionIntoSession(
      sessionAnchorRef.current,
      recognitionCommittedRef.current,
    )
    sessionAnchorRef.current = merged
    recognitionCommittedRef.current = ''
    return merged
  }, [])

  useEffect(() => {
    return () => {
      intentionalStopRef.current = true
      clearRestartTimer()
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [clearRestartTimer])

  const stop = useCallback(() => {
    intentionalStopRef.current = true
    clearRestartTimer()
    const frozen = freezeRecognitionIntoAnchor()
    recognitionRef.current?.stop()
    setListening(false)
    emitTranscript(frozen, '')
    voiceDebug('stop', { committed: frozen })
  }, [clearRestartTimer, emitTranscript, freezeRecognitionIntoAnchor])

  const start = useCallback((options?: { preserveSession?: boolean }) => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      onErrorRef.current?.('unsupported')
      return
    }

    const preserveSession = Boolean(options?.preserveSession)
    intentionalStopRef.current = false
    clearRestartTimer()
    recognitionRef.current?.abort()
    sessionIdRef.current += 1
    const sessionId = sessionIdRef.current

    if (preserveSession) {
      // Keep-alive remount / language switch — never drop already-committed speech.
      recognitionCommittedRef.current = ''
    } else {
      sessionAnchorRef.current = ''
      recognitionCommittedRef.current = ''
      lastEmittedCommittedRef.current = ''
      lastFinalAtRef.current = 0
      setCommitted('')
      setInterim('')
      onTranscriptRef.current?.({ committed: '', interim: '' })
    }

    const recognition = new Ctor()
    recognition.lang = opts.lang || 'en-US'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 5

    recognition.onresult = (event) => {
      if (sessionId !== sessionIdRef.current) return

      const { recognitionCommitted, interim: interimText } = rebuildRecognitionTranscript(
        event.results,
      )
      recognitionCommittedRef.current = recognitionCommitted
      const sessionCommitted = mergeRecognitionIntoSession(
        sessionAnchorRef.current,
        recognitionCommitted,
      )

      voiceDebug('result', {
        resultIndex: event.resultIndex,
        resultCount: event.results.length,
        recognitionCommitted,
        interim: interimText,
        sessionAnchor: sessionAnchorRef.current,
        sessionCommitted,
      })

      emitTranscript(sessionCommitted, interimText)
    }

    recognition.onerror = (event) => {
      if (sessionId !== sessionIdRef.current) return
      // Silence / aborted are normal while keep-alive dictation is running.
      if (event.error === 'aborted' || event.error === 'no-speech') {
        voiceDebug('error-ignored', { error: event.error })
        return
      }
      if (keepAliveRef.current && event.error === 'network') {
        voiceDebug('error-ignored', { error: event.error })
        return
      }
      voiceDebug('error', { error: event.error })
      onErrorRef.current?.(event.error)
      intentionalStopRef.current = true
      setListening(false)
      const frozen = freezeRecognitionIntoAnchor()
      emitTranscript(frozen, '')
    }

    recognition.onend = () => {
      if (sessionId !== sessionIdRef.current) return

      const frozen = freezeRecognitionIntoAnchor()
      emitTranscript(frozen, '')

      if (intentionalStopRef.current || !keepAliveRef.current) {
        setListening(false)
        voiceDebug('end', { reason: 'stop', committed: frozen })
        return
      }

      voiceDebug('end-restart', { committed: frozen })
      clearRestartTimer()
      restartTimerRef.current = setTimeout(() => {
        if (intentionalStopRef.current || !keepAliveRef.current) {
          setListening(false)
          return
        }
        if (sessionId !== sessionIdRef.current) return
        try {
          // Same Recognition object — results array resets; anchor keeps session text.
          recognitionCommittedRef.current = ''
          recognition.start()
          setListening(true)
        } catch {
          recognitionRef.current = null
          start({ preserveSession: true })
        }
      }, 280)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
      voiceDebug('start', {
        lang: recognition.lang,
        keepAlive: keepAliveRef.current,
        preserveSession,
      })
    } catch {
      onErrorRef.current?.('start-failed')
      setListening(false)
    }
  }, [clearRestartTimer, emitTranscript, freezeRecognitionIntoAnchor, opts.lang])

  // If the speech language changes while listening, restart with the new locale.
  useEffect(() => {
    if (!listening) return
    const current = recognitionRef.current
    if (!current) return
    if (current.lang === (opts.lang || 'en-US')) return
    sessionAnchorRef.current = freezeRecognitionIntoAnchor()
    lastEmittedCommittedRef.current = sessionAnchorRef.current
    intentionalStopRef.current = false
    start({ preserveSession: true })
  }, [opts.lang, listening, start, freezeRecognitionIntoAnchor])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  return {
    supported,
    listening,
    committed,
    interim,
    /** committed + interim for display labels */
    preview: composeVoiceFieldValue('', committed, interim),
    start,
    stop,
    toggle,
  }
}
