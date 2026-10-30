/**
 * Public images for product emails: GET /email-assets/<sha256>.<ext>. Keys are content hashes, so
 * responses are immutable; the content type comes from the key (sniffed at upload), never from
 * user input, and the response cannot be rendered as a document.
 */
import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { EMAIL_ASSET_KEY_RE, EMAIL_ASSET_PATH, EMAIL_ASSET_STORE, contentTypeForKey } from './_shared/email/images.ts'

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } })

export default async (request: Request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
  const key = new URL(request.url).pathname.slice(EMAIL_ASSET_PATH.length)
  if (!EMAIL_ASSET_KEY_RE.test(key)) return notFound()
  const contentType = contentTypeForKey(key)
  if (!contentType) return notFound()

  const data = await getStore({ name: EMAIL_ASSET_STORE }).get(key, { type: 'arrayBuffer' })
  if (!data) return notFound()
  return new Response(request.method === 'HEAD' ? null : data, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(data.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  })
}

export const config: Config = {
  path: '/email-assets/*',
}
