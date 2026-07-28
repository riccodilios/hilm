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
  onFinal: (transcript: string) => void
  onError?: (message: string) => void
}) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onFinalRef = useRef(opts.onFinal)
  const onErrorRef = useRef(opts.onError)
  const supported = isSpeechDictationSupported()

  useEffect(() => {
    onFinalRef.current = opts.onFinal
  }, [opts.onFinal])

  useEffect(() => {
    onErrorRef.current = opts.onError
  }, [opts.onError])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      onErrorRef.current?.('unsupported')
      return
    }

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
      if (event.error === 'aborted' || event.error === 'no-speech') return
      onErrorRef.current?.(event.error)
      setListening(false)
      setInterim('')
    }

    recognition.onend = () => {
      setListening(false)
      setInterim('')
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
  }, [opts.lang])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  return { supported, listening, interim, start, stop, toggle }
}
