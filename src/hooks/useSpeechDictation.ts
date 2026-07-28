import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
  }>
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

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
  lang?: string
  /** When true, recognition restarts after silence / browser pause so the user can keep talking. */
  keepAlive?: boolean
  onFinal: (transcript: string) => void
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

    const recognition = new Ctor()
    recognition.lang = opts.lang || 'en-US'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event) => {
      let interimText = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const piece = result[0]?.transcript?.trim() ?? ''
        if (!piece) continue
        if (result.isFinal) finalText = finalText ? `${finalText} ${piece}` : piece
        else interimText = interimText ? `${interimText} ${piece}` : piece
      }
      setInterim(interimText)
      if (finalText) onFinalRef.current(finalText)
    }

    recognition.onerror = (event) => {
      // Silence / aborted are normal while keep-alive dictation is running.
      if (event.error === 'aborted' || event.error === 'no-speech') return
      if (keepAliveRef.current && event.error === 'network') return
      onErrorRef.current?.(event.error)
      intentionalStopRef.current = true
      setListening(false)
      setInterim('')
    }

    recognition.onend = () => {
      setInterim('')
      if (intentionalStopRef.current || !keepAliveRef.current) {
        setListening(false)
        return
      }
      // Browsers end recognition after pauses even with continuous=true — restart quietly.
      clearRestartTimer()
      restartTimerRef.current = setTimeout(() => {
        if (intentionalStopRef.current || !keepAliveRef.current) {
          setListening(false)
          return
        }
        try {
          recognition.start()
          setListening(true)
        } catch {
          // Some browsers require a fresh instance after onend.
          recognitionRef.current = null
          start()
        }
      }, 180)
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

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  return { supported, listening, interim, start, stop, toggle }
}
