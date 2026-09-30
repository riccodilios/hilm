import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { callMeetingProcess, finalizeRecording, meetingKeys, uploadMeetingSegment } from '../api'
import type { MeetingOs } from '../types'
import { CaptureError, PcmCapture, type CaptureInterruption, type CaptureMode } from './capture'
import { PcmSegmenter, type PcmSegment } from './segmenter'
import {
  enqueueSegment,
  isQueueSupported,
  listQueuedSegments,
  removeQueuedSegment,
  updateQueuedSegment,
  type QueuedSegment,
} from './segment-queue'
import { encodeWav } from './wav-encoder'
import { MeetingRecorderDock } from './MeetingRecorderDock'
import {
  RecorderContext,
  type PersistedSession,
  type RecorderApi,
  type RecorderErrorCode,
  type RecorderSession,
  type RecorderState,
  type RecorderStatus,
} from './recorder-context'

const ACTIVE_KEY = 'hilm.meetingRecorder.active'
const QUOTA_CODES = new Set(['meeting_too_long', 'monthly_meeting_limit', 'tier_disabled'])
const DROP_CODES = new Set(['not_found', 'invalid_path', 'invalid_segment', 'invalid_os'])

function readPersisted(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    return raw ? (JSON.parse(raw) as PersistedSession) : null
  } catch {
    return null
  }
}

function writePersisted(value: PersistedSession | null) {
  try {
    if (value) localStorage.setItem(ACTIVE_KEY, JSON.stringify(value))
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Storage may be unavailable in private mode; recording still works in memory.
  }
}

type WakeLockSentinelLike = { release: () => Promise<void> }
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }

export function MeetingRecorderProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<RecorderState>(() => ({
    status: 'idle',
    session: null,
    elapsedMs: 0,
    level: 0,
    notice: null,
    error: null,
    pendingUploads: 0,
    interrupted: readPersisted(),
  }))

  const captureRef = useRef<PcmCapture | null>(null)
  const segmenterRef = useRef<PcmSegmenter | null>(null)
  const sessionRef = useRef<RecorderSession | null>(null)
  const statusRef = useRef<RecorderStatus>('idle')
  const memoryQueueRef = useRef<QueuedSegment[]>([])
  const uploadingRef = useRef(false)
  const retryTimerRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const drivingRef = useRef(new Set<string>())
  const rerunRef = useRef(new Set<string>())
  const levelRef = useRef(0)
  const stopRef = useRef<() => Promise<void>>(async () => undefined)

  const setStatus = useCallback((status: RecorderStatus) => {
    statusRef.current = status
    setState((prev) => ({ ...prev, status }))
  }, [])

  const invalidateMeeting = useCallback(
    (os: MeetingOs, meetingId: string) => {
      void queryClient.invalidateQueries({ queryKey: meetingKeys.detail(os, meetingId) })
      void queryClient.invalidateQueries({ queryKey: [...meetingKeys.all, os, 'list'] })
    },
    [queryClient],
  )

  // ── Processing driver (advances server work part by part) ────────────────
  const driveProcessing = useCallback(
    (os: MeetingOs, meetingId: string, locale?: string) => {
      const key = `${os}:${meetingId}`
      if (drivingRef.current.has(key)) {
        rerunRef.current.add(key)
        return
      }
      drivingRef.current.add(key)
      void (async () => {
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
        const transient = (code: string) =>
          code === 'rate_limited' ||
          code === 'ai_limit' ||
          code === 'provider_timeout' ||
          code === 'provider_error' ||
          code === 'network' ||
          code.startsWith('http_429') ||
          code.startsWith('http_5')
        try {
          let step = 0
          let transientStrikes = 0
          do {
            rerunRef.current.delete(key)
            for (; step < 400; step += 1) {
              const result = await callMeetingProcess({ action: 'advance', os, meetingId, locale })
              // Refresh UI periodically — not every busy poll — to avoid query churn storms.
              if (step % 2 === 0 || !result.ok || (result.ok && !result.more)) {
                invalidateMeeting(os, meetingId)
              }
              if (!result.ok) {
                if (transient(result.code) && transientStrikes < 12) {
                  const delay = Math.min(60_000, 4_000 * 2 ** Math.min(transientStrikes, 4))
                  transientStrikes += 1
                  await sleep(delay)
                  continue
                }
                break
              }
              transientStrikes = 0
              if (result.state === 'busy') {
                await sleep(4_000)
                continue
              }
              if (!result.more) break
            }
          } while (rerunRef.current.has(key) && step < 400)
        } finally {
          drivingRef.current.delete(key)
          rerunRef.current.delete(key)
          invalidateMeeting(os, meetingId)
        }
      })()
    },
    [invalidateMeeting],
  )

  // ── Upload queue ─────────────────────────────────────────────────────────
  const refreshPending = useCallback(async () => {
    let count = memoryQueueRef.current.length
    if (isQueueSupported()) {
      try {
        count += (await listQueuedSegments()).length
      } catch {
        // ignore
      }
    }
    setState((prev) => (prev.pendingUploads === count ? prev : { ...prev, pendingUploads: count }))
  }, [])

  const flushUploads = useCallback(async () => {
    if (uploadingRef.current) return
    uploadingRef.current = true
    try {
      let items: QueuedSegment[] = [...memoryQueueRef.current]
      if (isQueueSupported()) {
        try {
          items = [...(await listQueuedSegments()), ...items]
        } catch {
          // fall back to memory queue only
        }
      }
      for (const item of items) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) break
        const removeItem = async () => {
          memoryQueueRef.current = memoryQueueRef.current.filter((queued) => queued.key !== item.key)
          if (isQueueSupported()) await removeQueuedSegment(item.key).catch(() => undefined)
        }
        try {
          const result = await uploadMeetingSegment(item)
          if (result.ok) {
            await removeItem()
            invalidateMeeting(item.os, item.meetingId)
            driveProcessing(item.os, item.meetingId, sessionRef.current?.locale)
            continue
          }
          if (QUOTA_CODES.has(result.code)) {
            await removeItem()
            setState((prev) => ({ ...prev, error: { code: result.code as RecorderErrorCode, message: result.message } }))
            if (sessionRef.current?.meetingId === item.meetingId && statusRef.current !== 'idle') {
              void stopRef.current()
            }
            continue
          }
          if (DROP_CODES.has(result.code)) {
            await removeItem()
            continue
          }
          throw new Error(result.message)
        } catch (error) {
          const next = { ...item, attempts: item.attempts + 1, lastError: error instanceof Error ? error.message : 'upload failed' }
          if (isQueueSupported() && !memoryQueueRef.current.some((queued) => queued.key === item.key)) {
            await updateQueuedSegment(next).catch(() => undefined)
          } else {
            memoryQueueRef.current = memoryQueueRef.current.map((queued) => (queued.key === item.key ? next : queued))
          }
          const delay = Math.min(60_000, 3000 * 2 ** Math.min(next.attempts, 5))
          if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current)
          retryTimerRef.current = window.setTimeout(() => void flushUploads(), delay)
          break
        }
      }
    } finally {
      uploadingRef.current = false
      void refreshPending()
    }
  }, [driveProcessing, invalidateMeeting, refreshPending])

  const handleSegment = useCallback(
    async (segment: PcmSegment) => {
      const session = sessionRef.current
      if (!session) return
      const wav = encodeWav(segment.chunks)
      const base = {
        os: session.os,
        meetingId: session.meetingId,
        idx: segment.idx,
        storagePath: session.storagePathFor(segment.idx),
        offsetMs: segment.offsetMs,
        durationMs: segment.durationMs,
        wav,
      }
      let queued = false
      if (isQueueSupported()) {
        try {
          await enqueueSegment(base)
          queued = true
        } catch {
          queued = false
        }
      }
      if (!queued) {
        memoryQueueRef.current.push({ ...base, key: `${base.os}:${base.meetingId}:${base.idx}`, attempts: 0, createdAt: Date.now() })
      }
      void refreshPending()
      void flushUploads()
    },
    [flushUploads, refreshPending],
  )

  // ── Wake lock ─────────────────────────────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    const nav = navigator as WakeLockNavigator
    if (!nav.wakeLock || wakeLockRef.current) return
    try {
      wakeLockRef.current = await nav.wakeLock.request('screen')
    } catch {
      wakeLockRef.current = null
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release().catch(() => undefined)
    wakeLockRef.current = null
  }, [])

  // ── Controls ─────────────────────────────────────────────────────────────
  const handleInterrupted = useCallback(
    (reason: CaptureInterruption) => {
      if (statusRef.current !== 'recording') return
      captureRef.current?.pause()
      const segment = segmenterRef.current?.flush()
      if (segment) void handleSegment(segment)
      setStatus('paused')
      const notice =
        reason === 'device_lost' ? 'device_lost' : reason === 'display_ended' ? 'display_ended' : 'interrupted'
      setState((prev) => ({ ...prev, notice, level: 0 }))
    },
    [handleSegment, setStatus],
  )

  const createCapture = useCallback(() => {
    return new PcmCapture({
      onPcm: (pcm) => {
        const segmenter = segmenterRef.current
        if (!segmenter) return
        for (const segment of segmenter.push(pcm)) void handleSegment(segment)
        const max = sessionRef.current?.maxMs
        if (max && segmenter.totalMs >= max && statusRef.current === 'recording') {
          setState((prev) => ({ ...prev, notice: 'limit_reached' }))
          void stopRef.current()
        }
      },
      onLevel: (level) => {
        levelRef.current = level
      },
      onInterrupted: handleInterrupted,
    })
  }, [handleInterrupted, handleSegment])

  const start = useCallback(
    async (session: RecorderSession) => {
      if (statusRef.current !== 'idle') return false
      sessionRef.current = session
      segmenterRef.current = new PcmSegmenter({ startIdx: session.startIdx, startOffsetMs: session.startOffsetMs })
      setState((prev) => ({
        ...prev,
        status: 'requesting',
        session,
        elapsedMs: session.startOffsetMs,
        notice: null,
        error: null,
      }))
      statusRef.current = 'requesting'
      const capture = createCapture()
      try {
        await capture.start(session.captureMode)
      } catch (error) {
        await capture.stop()
        sessionRef.current = null
        segmenterRef.current = null
        const code = error instanceof CaptureError ? error.code : 'unknown'
        statusRef.current = 'idle'
        setState((prev) => ({ ...prev, status: 'idle', session: null, error: { code } }))
        return false
      }
      captureRef.current = capture
      writePersisted({
        os: session.os,
        meetingId: session.meetingId,
        title: session.title,
        href: session.href,
        startedAt: Date.now(),
      })
      setState((prev) => ({ ...prev, interrupted: null }))
      setStatus('recording')
      void acquireWakeLock()
      invalidateMeeting(session.os, session.meetingId)
      return true
    },
    [acquireWakeLock, createCapture, invalidateMeeting, setStatus],
  )

  const pause = useCallback(() => {
    if (statusRef.current !== 'recording') return
    captureRef.current?.pause()
    setStatus('paused')
    setState((prev) => ({ ...prev, level: 0 }))
    releaseWakeLock()
  }, [releaseWakeLock, setStatus])

  const resume = useCallback(async () => {
    if (statusRef.current !== 'paused') return
    const session = sessionRef.current
    let capture = captureRef.current
    // Display share ending makes capture not alive — user must pick the tab again on resume.
    if (!capture || !capture.isAlive) {
      await capture?.stop()
      if (!session) {
        setState((prev) => ({ ...prev, notice: 'interrupted' }))
        return
      }
      capture = createCapture()
      try {
        await capture.start(session.captureMode)
      } catch (error) {
        const code = error instanceof CaptureError ? error.code : 'unknown'
        setState((prev) => ({ ...prev, error: { code } }))
        return
      }
      captureRef.current = capture
    } else {
      const running = await capture.resume()
      if (!running) {
        setState((prev) => ({ ...prev, notice: 'interrupted' }))
        return
      }
    }
    setState((prev) => ({
      ...prev,
      notice: prev.notice === 'limit_reached' ? prev.notice : null,
    }))
    setStatus('recording')
    void acquireWakeLock()
  }, [acquireWakeLock, createCapture, setStatus])

  const setCaptureMode = useCallback(
    async (mode: CaptureMode) => {
      const session = sessionRef.current
      if (!session) return false
      if (statusRef.current !== 'recording' && statusRef.current !== 'paused') return false
      if (session.captureMode === mode && captureRef.current?.isAlive && statusRef.current === 'recording') {
        return true
      }

      // Keep the same meeting timeline — flush the open part, then swap capture pipelines.
      const flushed = segmenterRef.current?.flush()
      if (flushed) void handleSegment(flushed)

      const previousMode = session.captureMode
      const oldCapture = captureRef.current
      captureRef.current = null
      await oldCapture?.stop()

      const nextSession = { ...session, captureMode: mode }
      sessionRef.current = nextSession
      statusRef.current = 'requesting'
      setState((prev) => ({
        ...prev,
        session: nextSession,
        status: 'requesting',
        error: null,
        notice: null,
        level: 0,
      }))

      const capture = createCapture()
      try {
        await capture.start(mode)
      } catch (error) {
        await capture.stop()
        const code = error instanceof CaptureError ? error.code : 'unknown'
        // Prefer restoring the previous mode so the meeting keeps going.
        if (previousMode !== mode) {
          const fallback = createCapture()
          try {
            await fallback.start(previousMode)
            captureRef.current = fallback
            const restored = { ...session, captureMode: previousMode }
            sessionRef.current = restored
            statusRef.current = 'recording'
            setState((prev) => ({
              ...prev,
              session: restored,
              status: 'recording',
              error: { code },
              level: 0,
            }))
            void acquireWakeLock()
            return false
          } catch {
            await fallback.stop()
          }
        }
        statusRef.current = 'paused'
        setState((prev) => ({ ...prev, status: 'paused', error: { code }, level: 0 }))
        return false
      }

      captureRef.current = capture
      setStatus('recording')
      void acquireWakeLock()
      return true
    },
    [acquireWakeLock, createCapture, handleSegment, setStatus],
  )

  const stop = useCallback(async () => {
    const session = sessionRef.current
    if (!session || statusRef.current === 'idle' || statusRef.current === 'finishing') return
    setStatus('finishing')
    const capture = captureRef.current
    captureRef.current = null
    await capture?.stop()
    releaseWakeLock()
    const segmenter = segmenterRef.current
    const last = segmenter?.flush()
    if (last) await handleSegment(last)
    const expectedSegments = segmenter?.currentIdx ?? session.startIdx
    const durationMs = segmenter?.totalMs ?? session.startOffsetMs
    try {
      await finalizeRecording(session.os, session.meetingId, {
        expectedSegments,
        durationSeconds: durationMs / 1000,
      })
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: { code: 'upload_failed', message: error instanceof Error ? error.message : undefined },
      }))
    }
    writePersisted(null)
    sessionRef.current = null
    segmenterRef.current = null
    statusRef.current = 'idle'
    setState((prev) => ({ ...prev, status: 'idle', session: null, level: 0, elapsedMs: 0 }))
    invalidateMeeting(session.os, session.meetingId)
    if (expectedSegments > 0) driveProcessing(session.os, session.meetingId, session.locale)
  }, [driveProcessing, handleSegment, invalidateMeeting, releaseWakeLock, setStatus])

  useEffect(() => {
    stopRef.current = stop
  }, [stop])

  // Elapsed time + level meter tick.
  useEffect(() => {
    if (state.status !== 'recording' && state.status !== 'paused') return
    const timer = window.setInterval(() => {
      const elapsed = segmenterRef.current?.totalMs ?? 0
      const level = statusRef.current === 'recording' ? levelRef.current : 0
      setState((prev) =>
        prev.elapsedMs === elapsed && Math.abs(prev.level - level) < 0.02 ? prev : { ...prev, elapsedMs: elapsed, level },
      )
    }, 200)
    return () => window.clearInterval(timer)
  }, [state.status])

  // Resume any parts left over from an earlier session, and retry when back online.
  useEffect(() => {
    void flushUploads()
    const onOnline = () => void flushUploads()
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current)
    }
  }, [flushUploads])

  // Protect against closing the tab while recording or while audio is still uploading.
  useEffect(() => {
    const active = state.status !== 'idle' || state.pendingUploads > 0
    if (!active) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state.pendingUploads, state.status])

  // Returning to the app: re-acquire wake lock and detect suspended audio (iOS background, calls).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (statusRef.current === 'recording') {
        void acquireWakeLock()
        const capture = captureRef.current
        if (capture && capture.contextState !== 'running') {
          void capture.resume().then((running) => {
            if (!running) handleInterrupted('suspended')
          })
        }
      }
      void flushUploads()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [acquireWakeLock, flushUploads, handleInterrupted])

  const value = useMemo<RecorderApi>(
    () => ({
      ...state,
      start,
      pause,
      resume,
      stop,
      setCaptureMode,
      clearError: () => setState((prev) => ({ ...prev, error: null })),
      clearInterrupted: () => {
        writePersisted(null)
        setState((prev) => ({ ...prev, interrupted: null }))
      },
      isActiveFor: (meetingId: string) => state.session?.meetingId === meetingId && state.status !== 'idle',
      driveProcessing,
    }),
    [driveProcessing, pause, resume, setCaptureMode, start, state, stop],
  )

  return (
    <RecorderContext.Provider value={value}>
      {children}
      <MeetingRecorderDock />
    </RecorderContext.Provider>
  )
}