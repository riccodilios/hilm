import { useCallback, useEffect, useRef, useState } from 'react'
import {
  bestTranscriptAlternative,
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

export type SpeechFinalPayload = {
  transcript: string
  confidence: number
  /** Ms since the previous final chunk (0 if first). */
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

export function useSpeechDictation(opts: {
  lang?: SpeechLocale | string
  /** When true, recognition restarts after silence / browser pause so the user can keep talking. */
  keepAlive?: boolean
  onFinal: (transcript: string, meta: SpeechFinalPayload) => void
  onError?: (message: string) => void
}) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onFinalRef = useRef(opts.onFinal)
  const onErrorRef = useRef(opts.onError)
  const keepAliveRef = useRef(Boolean(opts.keepAlive))
  const intentionalStopRef = useRef(false)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFinalAtRef = useRef(0)
  const lastFinalNormRef = useRef('')
  const sessionIdRef = useRef(0)
  const supported = isSpeechDictationSupported()

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
    recognitionRef.current?.stop()
    setListening(false)
    setInterim('')
  }, [clearRestartTimer])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      onErrorRef.current?.('unsupported')
      return
    }

    intentionalStopRef.current = false
    clearRestartTimer()
    recognitionRef.current?.abort()
    sessionIdRef.current += 1
    const sessionId = sessionIdRef.current

    const recognition = new Ctor()
    recognition.lang = opts.lang || 'en-US'
    // continuous=false reduces duplicate finals; keepAlive restarts after pauses.
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 3

    recognition.onresult = (event) => {
      if (sessionId !== sessionIdRef.current) return

      let interimText = ''
      const finals: Array<{ text: string; confidence: number }> = []

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const { text, confidence } = bestTranscriptAlternative(result)
        if (!text) continue
        if (result.isFinal) finals.push({ text, confidence })
        else interimText = interimText ? `${interimText} ${text}` : text
      }

      setInterim(interimText.replace(/\s+/g, ' ').trim())

      for (const piece of finals) {
        const norm = piece.text.replace(/\s+/g, ' ').trim().toLowerCase()
        if (!norm) continue
        // Drop immediate duplicate finals (common on restart / Chrome quirks).
        if (norm === lastFinalNormRef.current) continue
        if (
          lastFinalNormRef.current &&
          (lastFinalNormRef.current.endsWith(norm) || norm.endsWith(lastFinalNormRef.current))
        ) {
          // Prefer the longer form once; skip the shorter echo.
          if (norm.length <= lastFinalNormRef.current.length) continue
        }

        const now = Date.now()
        const gapMs = lastFinalAtRef.current ? now - lastFinalAtRef.current : 0
        lastFinalAtRef.current = now
        lastFinalNormRef.current = norm
        onFinalRef.current(piece.text.replace(/\s+/g, ' ').trim(), {
          transcript: piece.text.replace(/\s+/g, ' ').trim(),
          confidence: piece.confidence,
          gapMs,
        })
      }
    }

    recognition.onerror = (event) => {
      if (sessionId !== sessionIdRef.current) return
      // Silence / aborted are normal while keep-alive dictation is running.
      if (event.error === 'aborted' || event.error === 'no-speech') return
      if (keepAliveRef.current && event.error === 'network') return
      onErrorRef.current?.(event.error)
      intentionalStopRef.current = true
      setListening(false)
      setInterim('')
    }

    recognition.onend = () => {
      if (sessionId !== sessionIdRef.current) return
      setInterim('')
      if (intentionalStopRef.current || !keepAliveRef.current) {
        setListening(false)
        return
      }
      // Browsers end recognition after pauses — restart with a short delay.
      clearRestartTimer()
      restartTimerRef.current = setTimeout(() => {
        if (intentionalStopRef.current || !keepAliveRef.current) {
          setListening(false)
          return
        }
        if (sessionId !== sessionIdRef.current) return
        try {
          recognition.start()
          setListening(true)
        } catch {
          recognitionRef.current = null
          start()
        }
      }, 280)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
      setInterim('')
    } catch {
      onErrorRef.current?.('start-failed')
      setListening(false)
    }
  }, [clearRestartTimer, opts.lang])

  // If the speech language changes while listening, restart with the new locale.
  useEffect(() => {
    if (!listening) return
    const current = recognitionRef.current
    if (!current) return
    if (current.lang === (opts.lang || 'en-US')) return
    intentionalStopRef.current = false
    start()
  }, [opts.lang, listening, start])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  return { supported, listening, interim, start, stop, toggle }
}
