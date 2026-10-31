/**
 * Capacity forecast for N organizations (workspaces) under low / medium / high usage.
 * Pure: inputs are measured values (when available) plus documented per-profile assumptions,
 * and every output says which of the two it came from. Nothing here is a provider measurement.
 */

export type UsageProfile = 'low' | 'medium' | 'high'

export type ProfileAssumptions = {
  membersPerOrg: number
  /** Meeting audio recorded per organization per month. */
  audioHoursPerOrgMonth: number
  attachmentsPerOrgMonth: number
  avgAttachmentBytes: number
  /** Database growth per organization per month (tasks, transcripts, activity, AI logs). */
  dbBytesPerOrgMonth: number
  invocationsPerMemberMonth: number
  bandwidthBytesPerMemberMonth: number
  /** Supabase API + storage downloads per member, excluding transcription fetches. */
  egressBytesPerMemberMonth: number
  aiUsdPerMemberMonth: number
  emailsPerMemberMonth: number
}

export const PROFILES: Record<UsageProfile, ProfileAssumptions> = {
  low: {
    membersPerOrg: 5,
    audioHoursPerOrgMonth: 4,
    attachmentsPerOrgMonth: 20,
    avgAttachmentBytes: 500 * 1024,
    dbBytesPerOrgMonth: 4 * 1024 ** 2,
    invocationsPerMemberMonth: 150,
    bandwidthBytesPerMemberMonth: 50 * 1024 ** 2,
    egressBytesPerMemberMonth: 30 * 1024 ** 2,
    aiUsdPerMemberMonth: 0.05,
    emailsPerMemberMonth: 10,
  },
  medium: {
    membersPerOrg: 15,
    audioHoursPerOrgMonth: 20,
    attachmentsPerOrgMonth: 100,
    avgAttachmentBytes: 1024 ** 2,
    dbBytesPerOrgMonth: 15 * 1024 ** 2,
    invocationsPerMemberMonth: 300,
    bandwidthBytesPerMemberMonth: 150 * 1024 ** 2,
    egressBytesPerMemberMonth: 100 * 1024 ** 2,
    aiUsdPerMemberMonth: 0.25,
    emailsPerMemberMonth: 30,
  },
  high: {
    membersPerOrg: 40,
    audioHoursPerOrgMonth: 80,
    attachmentsPerOrgMonth: 400,
    avgAttachmentBytes: 1.5 * 1024 ** 2,
    dbBytesPerOrgMonth: 50 * 1024 ** 2,
    invocationsPerMemberMonth: 600,
    bandwidthBytesPerMemberMonth: 400 * 1024 ** 2,
    egressBytesPerMemberMonth: 300 * 1024 ** 2,
    aiUsdPerMemberMonth: 1,
    emailsPerMemberMonth: 80,
  },
}

export type ForecastInputs = {
  /** Measured audio bytes per hour of recording (falls back to 12 MB/h ≈ 27 kbit/s Opus). */
  audioBytesPerHour?: number | null
  /** Current database size; the fixed part is carried forward. */
  currentDbBytes?: number | null
  /** Invocations that do not depend on users (the scheduler: 1/min). */
  fixedInvocationsMonth?: number
  attachmentRetentionDays?: number
  quarantineDays?: number
  /** Audio kept after transcription (0 when lifecycle disposal is on). */
  audioRetentionDays?: number
  sonioxUsdPerHour?: number
  horizonMonths?: number
}

export type Limits = {
  storageBytes: number
  dbBytes: number
  egressBytes: number
  invocations: number
  bandwidthBytes: number
  emailsMonth: number
  emailsDay: number
}

export const FREE_LIMITS: Limits = {
  storageBytes: 1024 ** 3,
  dbBytes: 500 * 1024 ** 2,
  egressBytes: 5 * 1024 ** 3,
  invocations: 125_000,
  bandwidthBytes: 100 * 1024 ** 3,
  emailsMonth: 3_000,
  emailsDay: 100,
}

export type ForecastRow = {
  orgs: number
  profile: UsageProfile
  members: number
  storageBytes: number
  storageBytesWithoutLifecycle: number
  dbBytes: number
  egressBytesMonth: number
  invocationsMonth: number
  bandwidthBytesMonth: number
  aiUsdMonth: number
  sonioxUsdMonth: number
  emailsMonth: number
  emailsPeakDay: number
  exceeds: Array<keyof Limits>
  recommendations: string[]
}

export const ORG_COUNTS = [5, 10, 15, 25, 50, 100] as const

export function forecastRow(orgs: number, profile: UsageProfile, inputs: ForecastInputs = {}, limits: Limits = FREE_LIMITS): ForecastRow {
  const p = PROFILES[profile]
  const members = orgs * p.membersPerOrg
  const audioBytesPerHour = inputs.audioBytesPerHour && inputs.audioBytesPerHour > 0 ? inputs.audioBytesPerHour : 12 * 1024 ** 2
  const horizon = inputs.horizonMonths ?? 12
  const keptAttachmentDays = (inputs.attachmentRetentionDays ?? 90) + (inputs.quarantineDays ?? 14)
  const audioMonthBytes = orgs * p.audioHoursPerOrgMonth * audioBytesPerHour
  const attachmentMonthBytes = orgs * p.attachmentsPerOrgMonth * p.avgAttachmentBytes

  // Steady state with lifecycle: attachments for retention + quarantine, audio only while
  // waiting for transcription (≈ 1 day) or for the configured audio retention.
  const audioKeptDays = Math.max(1, inputs.audioRetentionDays ?? 0)
  const storageBytes = attachmentMonthBytes * (keptAttachmentDays / 30) + audioMonthBytes * (audioKeptDays / 30)
  const storageBytesWithoutLifecycle = (attachmentMonthBytes + audioMonthBytes) * horizon

  const dbFixed = Math.max(0, inputs.currentDbBytes ?? 0)
  const dbBytes = dbFixed + orgs * p.dbBytesPerOrgMonth * horizon
  // Soniox downloads each recording once through a signed URL: that is Supabase egress.
  const egressBytesMonth = members * p.egressBytesPerMemberMonth + audioMonthBytes
  const invocationsMonth = (inputs.fixedInvocationsMonth ?? 44_640) + members * p.invocationsPerMemberMonth
  const bandwidthBytesMonth = members * p.bandwidthBytesPerMemberMonth
  const aiUsdMonth = members * p.aiUsdPerMemberMonth
  const sonioxUsdMonth = orgs * p.audioHoursPerOrgMonth * (inputs.sonioxUsdPerHour ?? 0.1)
  const emailsMonth = members * p.emailsPerMemberMonth
  // Weekday traffic: about a third more than the flat daily average.
  const emailsPeakDay = Math.ceil((emailsMonth / 30) * 1.35)

  const usage: Record<keyof Limits, number> = {
    storageBytes,
    dbBytes,
    egressBytes: egressBytesMonth,
    invocations: invocationsMonth,
    bandwidthBytes: bandwidthBytesMonth,
    emailsMonth,
    emailsDay: emailsPeakDay,
  }
  const exceeds = (Object.keys(limits) as Array<keyof Limits>).filter((key) => usage[key] > limits[key])
  return {
    orgs,
    profile,
    members,
    storageBytes,
    storageBytesWithoutLifecycle,
    dbBytes,
    egressBytesMonth,
    invocationsMonth,
    bandwidthBytesMonth,
    aiUsdMonth,
    sonioxUsdMonth,
    emailsMonth,
    emailsPeakDay,
    exceeds,
    recommendations: recommendationsFor(exceeds),
  }
}

export function recommendationsFor(exceeds: Array<keyof Limits>): string[] {
  const out: string[] = []
  if (exceeds.some((k) => k === 'storageBytes' || k === 'dbBytes' || k === 'egressBytes')) {
    out.push('Supabase Pro (from $25/month: 8 GB database, 100 GB storage, 250 GB egress, daily backups).')
  }
  if (exceeds.some((k) => k === 'invocations' || k === 'bandwidthBytes')) {
    out.push('Netlify paid plan (more function invocations and bandwidth); compare current Netlify pricing first.')
  }
  if (exceeds.some((k) => k === 'emailsMonth' || k === 'emailsDay')) {
    out.push('Resend Pro ($20/month: 50,000 emails, no daily limit).')
  }
  return out
}

export function forecastMatrix(inputs: ForecastInputs = {}, limits: Limits = FREE_LIMITS) {
  const rows: ForecastRow[] = []
  for (const orgs of ORG_COUNTS) {
    for (const profile of ['low', 'medium', 'high'] as const) rows.push(forecastRow(orgs, profile, inputs, limits))
  }
  return rows
}

/** Linear growth projection: days until `limit` given the recent daily growth. */
export function daysUntilLimit(current: number, dailyGrowth: number, limit: number) {
  if (!(limit > 0)) return null
  if (current >= limit) return 0
  if (!(dailyGrowth > 0)) return null
  return Math.floor((limit - current) / dailyGrowth)
}
