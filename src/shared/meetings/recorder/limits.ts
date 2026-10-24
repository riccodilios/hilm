/** Warn this long before a plan or monthly limit stops the recording. */
export const RECORDING_LIMIT_WARNING_MS = 5 * 60_000

export type RecordingQuota = { maxMinutes: number; minutesPerMonth: number; usedMinutesMonth: number }

/**
 * Meeting-timeline position (ms) at which recording must stop: the plan's per-meeting maximum or
 * the remaining monthly minutes, whichever comes first. Null while the quota is unknown.
 */
export function recordingLimitMs(quota: RecordingQuota | null | undefined, startOffsetMs: number): number | null {
  if (!quota) return null
  const monthlyLeftMs = Math.max(0, (quota.minutesPerMonth - quota.usedMinutesMonth) * 60_000)
  return Math.min(quota.maxMinutes * 60_000, startOffsetMs + monthlyLeftMs)
}
