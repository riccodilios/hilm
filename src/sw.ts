/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

declare let self: ServiceWorkerGlobalScope

// Force clients onto the latest service worker after AI Apply reliability fixes.
self.skipWaiting()
clientsClaim()
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
  }),
)

registerRoute(
  ({ url }) => url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/'),
  new NetworkOnly(),
)

self.addEventListener('push', (event) => {
  let payload: {
    title?: string
    body?: string
    href?: string
    url?: string
    tag?: string
  } = {}

  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data?.text() }
  }

  const title = payload.title || 'Hilm'
  const body = payload.body || 'You have a reminder'
  const rawHref = payload.href || payload.url || '/personal'
  const href = (() => {
    try {
      const url = new URL(String(rawHref), self.location.origin)
      if (url.origin !== self.location.origin) return '/personal'
      const path = `${url.pathname}${url.search}${url.hash}`
      return path.startsWith('/') && !path.startsWith('//') ? path : '/personal'
    } catch {
      return '/personal'
    }
  })()
  const tag = payload.tag || 'hilm-reminder'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: { href },
      tag,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw =
    (event.notification.data && (event.notification.data as { href?: string }).href) || '/personal'
  let targetUrl = `${self.location.origin}/personal`
  try {
    const url = new URL(String(raw), self.location.origin)
    if (url.origin === self.location.origin) {
      const path = `${url.pathname}${url.search}${url.hash}`
      if (path.startsWith('/') && !path.startsWith('//')) {
        targetUrl = url.href
      }
    }
  } catch {
    /* keep fallback */
  }

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) {
            await (client as WindowClient).navigate(targetUrl)
          }
          return
        }
      }
      await self.clients.openWindow(targetUrl)
    })(),
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  // Client will re-subscribe on next settings visit / app open if needed.
  event.waitUntil(Promise.resolve())
})
