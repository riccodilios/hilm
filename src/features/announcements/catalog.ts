/**
 * What's New — feature-drop announcements only.
 *
 * DO announce: new features, major product capabilities, OS surface launches,
 * meaningful AI capabilities, substantial UX redesigns that users should notice.
 *
 * DO NOT announce: bug fixes, debugging, hotfixes, migrations, refactors,
 * dependency bumps, internal cleanups, or patch-only releases.
 *
 * Adding an entry: copy `defineFeatureAnnouncement({...})` below. Bump
 * `version` (semver). Users only ever see the newest entry they haven't acked.
 */

export type FeatureDropType =
  | 'new_feature'
  | 'major_improvement'
  | 'ui_redesign'
  | 'ai_capability'
  | 'workspace_feature'
  | 'personal_feature'

export type AnnouncementCta = {
  label: string
  href?: string
}

/**
 * Fixed announcement template. Every What's New modal uses this shape.
 *
 * Layout (rendered by WhatsNewModal):
 *   eyebrow: "What's New" · vX.Y.Z · category
 *   hero illustration band + accent icon
 *   title (feature name)
 *   description (1–2 sentences: what it is + why it matters)
 *   highlights (3–5 short bullets of user-facing value)
 *   primary CTA: Continue (dismiss)
 *   optional secondary CTAs: Learn More / Docs / Try it
 */
export type FeatureAnnouncement = {
  /** Semver for this feature drop only — not app package version for every commit. */
  version: string
  type: FeatureDropType
  /** Feature name — hero headline. */
  title: string
  /** One or two sentences. Lead with benefit, not internals. */
  description: string
  /** 3–5 user-facing highlights. No bug-fix language. */
  highlights: [string, string, string, ...string[]]
  /** Accent glyph key for the hero. */
  icon: 'sparkles' | 'tag' | 'workspace' | 'personal' | 'ai'
  primaryCta: AnnouncementCta
  secondaryCtas?: AnnouncementCta[]
  /** Optional hero image URL (full-bleed band). */
  illustration?: string
}

/** @deprecated Use FeatureAnnouncement */
export type Announcement = FeatureAnnouncement
/** @deprecated Use FeatureDropType */
export type AnnouncementType = FeatureDropType

const FEATURE_DROP_TYPES: readonly FeatureDropType[] = [
  'new_feature',
  'major_improvement',
  'ui_redesign',
  'ai_capability',
  'workspace_feature',
  'personal_feature',
] as const

export function defineFeatureAnnouncement(input: FeatureAnnouncement): FeatureAnnouncement {
  if (!FEATURE_DROP_TYPES.includes(input.type)) {
    throw new Error(`Invalid announcement type: ${input.type}`)
  }
  if (input.highlights.length < 3) {
    throw new Error('Feature announcements require at least 3 highlights')
  }
  if (!input.title.trim() || !input.description.trim()) {
    throw new Error('Feature announcements require title and description')
  }
  return {
    ...input,
    primaryCta: input.primaryCta ?? { label: 'Continue' },
  }
}

export const ANNOUNCEMENT_TYPE_LABEL: Record<FeatureDropType, string> = {
  new_feature: 'New feature',
  major_improvement: 'Major improvement',
  ui_redesign: 'UI redesign',
  ai_capability: 'New AI capability',
  workspace_feature: 'Workspace feature',
  personal_feature: 'Personal OS feature',
}

/**
 * Catalog of feature drops only.
 * Never add entries for bug fixes, hotfixes, or debugging.
 */
export const ANNOUNCEMENTS: FeatureAnnouncement[] = [
  defineFeatureAnnouncement({
    version: '1.3.0',
    type: 'new_feature',
    title: 'Project Labels & Hilm AI',
    description:
      'Labels are now first-class across Personal and Workspace, and Hilm AI can run multi-step workflows with the same tools you use in the UI.',
    highlights: [
      'Right-click or long-press a label to edit, recolor, rename, or delete',
      'Assign labels when creating or editing projects in both OS surfaces',
      'AI proposes ordered actions with confirmation for destructive steps',
      'Workspace AI can recommend assignees and surface workload risks',
    ],
    icon: 'sparkles',
    primaryCta: { label: 'Continue' },
    secondaryCtas: [
      { label: 'Try labels', href: '/personal/projects' },
      { label: 'Open AI', href: '/personal/ai' },
    ],
  }),
]

export function parseSemver(version: string): [number, number, number] {
  const cleaned = version.trim().replace(/^v/i, '')
  const parts = cleaned.split('.').map((p) => Number.parseInt(p, 10) || 0)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

export function compareSemver(a: string, b: string): number {
  const aa = parseSemver(a)
  const bb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (aa[i]! !== bb[i]!) return aa[i]! - bb[i]!
  }
  return 0
}

export function getLatestAnnouncement(): FeatureAnnouncement | null {
  if (!ANNOUNCEMENTS.length) return null
  return ANNOUNCEMENTS.reduce((best, item) =>
    compareSemver(item.version, best.version) > 0 ? item : best,
  )
}

export function shouldShowAnnouncement(
  lastSeen: string | null | undefined,
): FeatureAnnouncement | null {
  const latest = getLatestAnnouncement()
  if (!latest) return null
  if (!lastSeen) return latest
  return compareSemver(latest.version, lastSeen) > 0 ? latest : null
}
