import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { getAppUrl, getSupabaseAnonKey } from '@/lib/env'

function isIos() {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  )
}

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

export function getPushBlockerReason(): 'unsupported' | 'ios_homescreen' | null {
  if (typeof window === 'undefined') return null
  if (!isWebPushSupported()) return 'unsupported'
  if (isIos() && !isStandaloneDisplay()) return 'ios_homescreen'
  return null
}

export function getVapidPublicKey() {
  return (
    (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() ||
    (import.meta.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string | undefined)?.trim() ||
    'BGYLY2fz4F9KL0ESWiM9a8d9z2gIkta06xruQo3qmNQZJ5h_aR6khrmIcSz1yr_HtLP4w4pcsdhJd6i6o5xe35I'
  )
}

async function getRegistration() {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker unavailable')
  let existing = await navigator.serviceWorker.getRegistration()
  if (!existing) {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      existing = await navigator.serviceWorker.getRegistration()
      if (existing) break
    }
  }
  if (!existing) throw new Error('Service worker not ready — refresh and try again')
  await navigator.serviceWorker.ready
  return existing
}

export async function getLocalPushStatus() {
  const blocker = getPushBlockerReason()
  if (blocker) {
    return {
      blocker,
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
      localSubscription: false,
      serverSubscription: false,
    } as const
  }

  const registration = await navigator.serviceWorker.getRegistration()
  const local = Boolean(await registration?.pushManager.getSubscription())
  const userId = await requireUserId()
  const { count } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  return {
    blocker: null,
    permission: Notification.permission,
    localSubscription: local,
    serverSubscription: (count ?? 0) > 0,
  } as const
}

export async function enablePushNotifications() {
  const blocker = getPushBlockerReason()
  if (blocker === 'ios_homescreen') {
    throw new Error(
      'On iPhone/iPad, tap Share → Add to Home Screen, open Hilm from the icon, then enable Push.',
    )
  }
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

  const { count, error: verifyError } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (verifyError) throw verifyError
  if (!count) throw new Error('Subscription saved but not visible — try again')

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

export async function sendTestNotification() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const origin =
    typeof window !== 'undefined' && !/localhost|127\.0\.0\.1/i.test(window.location.origin)
      ? window.location.origin
      : getAppUrl() || (typeof window !== 'undefined' ? window.location.origin : '')

  const response = await fetch(`${origin.replace(/\/$/, '')}/api/notify-test`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: getSupabaseAnonKey(),
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
    pushed?: number
    subscriptions?: number
    hint?: string
  }
  if (!response.ok) throw new Error(payload.error || 'Test notification failed')
  return payload
}
