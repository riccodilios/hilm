import { useEffect, useRef, useState } from 'react'

/** Smoothed mic level above this counts as speech; below RELEASE (for HOLD_MS) counts as silence. */
const SPEECH_ON = 0.07
const SPEECH_RELEASE = 0.045
const HOLD_MS = 900
const SAMPLE_MS = 150

/**
 * Turns the raw 0..1 mic level into a smoothed level and a debounced "speaking" flag,
 * so visuals ease between silence and speech instead of flickering.
 */
export function useVoiceActivity(level: number, active: boolean) {
  const [state, setState] = useState({ speaking: false, level: 0 })
  const levelRef = useRef(level)
  levelRef.current = level

  useEffect(() => {
    if (!active) {
      setState({ speaking: false, level: 0 })
      return
    }
    let smooth = 0
    let speaking = false
    let quietSince: number | null = null
    const timer = window.setInterval(() => {
      const raw = levelRef.current
      smooth += (raw - smooth) * (raw > smooth ? 0.6 : 0.3)
      if (smooth >= SPEECH_ON) {
        quietSince = null
        speaking = true
      } else if (smooth < SPEECH_RELEASE) {
        const now = performance.now()
        quietSince ??= now
        if (now - quietSince >= HOLD_MS) speaking = false
      }
      const next = { speaking, level: Math.round(smooth * 100) / 100 }
      setState((prev) => (prev.speaking === next.speaking && prev.level === next.level ? prev : next))
    }, SAMPLE_MS)
    return () => window.clearInterval(timer)
  }, [active])

  return state
}
