/** Attachment upload guards shared by Personal + Workspace. */

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // 15 MB

const BLOCKED_MIME = new Set([
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/xml',
  'application/xml',
])

const BLOCKED_EXT = new Set([
  'svg',
  'html',
  'htm',
  'xhtml',
  'js',
  'mjs',
  'xml',
  'svgz',
])

export function assertSafeAttachment(file: File) {
  if (file.size <= 0) throw new Error('Empty file')
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('File is too large (max 15 MB)')
  }
  const mime = (file.type || '').toLowerCase().trim()
  if (mime && BLOCKED_MIME.has(mime)) {
    throw new Error('This file type is not allowed')
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext && BLOCKED_EXT.has(ext)) {
    throw new Error('This file type is not allowed')
  }
}

export function sanitizeAttachmentFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 180) || 'file'
}
