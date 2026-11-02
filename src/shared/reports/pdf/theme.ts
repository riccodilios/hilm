/** Hilm monochrome print palette (matches app zinc theme, no blue). */
export const HILM = {
  ink: '#111113',
  body: '#3f3f46',
  muted: '#71717a',
  mutedSoft: '#a1a1aa',
  border: '#d4d4d8',
  borderSubtle: '#e4e4e7',
  surface: '#f7f7f8',
  surface2: '#f1f1f3',
  paper: '#ffffff',
  cover: '#0a0a0b',
  coverFg: '#f4f4f5',
  coverMuted: '#a1a1aa',
  accent: '#18181b',
  accentOnCover: '#e4e4e7',
  /** Only for risk signals (blocked steps, high severity, off track). */
  risk: '#b91c1c',
  caution: '#a16207',
  good: '#15803d',
} as const

export function pdfFonts(arabic: boolean) {
  return {
    regular: arabic ? 'NotoSansArabic' : 'Helvetica',
    bold: arabic ? 'NotoSansArabic' : 'Helvetica-Bold',
  }
}
