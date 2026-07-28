import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

export function isWebPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function getVapidPublicKey() {
  return (
    (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() ||
    (import.meta.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string | undefined)?.trim() ||
    ''
  )
}

async function getRegistration() {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker unavailable')
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) {
    await navigator.serviceWorker.ready
    return existing
  }
  // vite-plugin-pwa registers automatically; wait briefly if still installing
  await new Promise((resolve) => setTimeout(resolve, 400))
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) throw new Error('Service worker not ready — refresh and try again')
  await navigator.serviceWorker.ready
  return reg
}

export async function enablePushNotifications() {
  if (!isWebPushSupported()) throw new Error('Push notifications are not supported in this browser')
  const vapid = getVapidPublicKey()
  if (!vapid) throw new Error('Missing VITE_VAPID_PUBLIC_KEY')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission denied')

  const registration = await getRegistration()
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    })
  }

  const json = subscription.toJSON()
  const endpoint = json.endpoint
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!endpoint || !p256dh || !auth) throw new Error('Invalid push subscription')

  const userId = await requireUserId()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent.slice(0, 280),
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
  return subscription
}

export async function disablePushNotifications() {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    const endpoint = subscription.endpoint
    await subscription.unsubscribe().catch(() => undefined)
    const userId = await requireUserId()
    await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint)
  } else {
    const userId = await requireUserId()
    await supabase.from('push_subscriptions').delete().eq('user_id', userId)
  }
}

export async function syncPushPreference(enabled: boolean) {
  if (enabled) await enablePushNotifications()
  else await disablePushNotifications()
}
