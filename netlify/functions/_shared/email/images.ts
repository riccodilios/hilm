/**
 * Images for product emails. Uploaded through the admin console, stored in Netlify Blobs under a
 * content hash, and served publicly from <appBaseUrl>/email-assets/<key>. Only raster formats
 * (no SVG, which can carry script) are accepted, detected from the bytes, not the declared type.
 * Emails may only reference images at that exact path on the app origin.
 */
import { createHash } from 'node:crypto'

export const EMAIL_ASSET_PATH = '/email-assets/'
/** Site-scoped Netlify Blobs store (survives deploys). */
export const EMAIL_ASSET_STORE = 'email-assets'
export const MAX_EMAIL_IMAGE_BYTES = 3 * 1024 * 1024
export const EMAIL_ASSET_KEY_RE = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const

export type ImageExt = keyof typeof TYPES

export function sniffImage(bytes: Uint8Array): { ext: ImageExt; contentType: string } | null {
  const b = bytes
  const ascii = (start: number, text: string) => [...text].every((ch, i) => b[start + i] === ch.charCodeAt(0))
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a) return { ext: 'png', contentType: TYPES.png }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', contentType: TYPES.jpg }
  if (b.length >= 6 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) return { ext: 'gif', contentType: TYPES.gif }
  if (b.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { ext: 'webp', contentType: TYPES.webp }
  return null
}

export function contentTypeForKey(key: string) {
  const ext = key.split('.').pop() as ImageExt
  return TYPES[ext] ?? null
}

export function assetKey(bytes: Uint8Array, ext: ImageExt) {
  return `${createHash('sha256').update(bytes).digest('hex')}.${ext}`
}

export function assetUrl(appBaseUrl: string, key: string) {
  return `${appBaseUrl}${EMAIL_ASSET_PATH}${key}`
}

/** True only for https URLs of uploaded assets on the app origin. */
export function allowedImageUrl(value: unknown, appBaseUrl: string): value is string {
  if (typeof value !== 'string' || value.length > 300) return false
  try {
    const url = new URL(value)
    const base = new URL(appBaseUrl)
    if (url.origin !== base.origin || url.search || url.hash) return false
    if (!url.pathname.startsWith(EMAIL_ASSET_PATH)) return false
    return EMAIL_ASSET_KEY_RE.test(url.pathname.slice(EMAIL_ASSET_PATH.length))
  } catch {
    return false
  }
}
