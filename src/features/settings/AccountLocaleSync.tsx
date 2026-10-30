import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { getSettings, updateSettings } from '@/features/settings/api'

function deviceTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && zone.length <= 64 ? zone : null
  } catch {
    return null
  }
}

/**
 * Keeps the account's language and time zone in step with the app, so emails sent by the server
 * (reminders, workspace notifications) use the user's language and local times. Writes only when
 * something changed.
 */
export function AccountLocaleSync() {
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const locale = i18n.language?.startsWith('ar') ? 'ar' : 'en'
  const synced = useRef<string | null>(null)

  useEffect(() => {
    if (!user) {
      synced.current = null
      return
    }
    const timeZone = deviceTimeZone()
    const key = `${user.id}|${locale}|${timeZone ?? ''}`
    if (synced.current === key) return
    synced.current = key

    let cancelled = false
    void (async () => {
      try {
        const settings = await getSettings()
        if (cancelled) return
        if (settings.locale === locale && (settings.time_zone ?? null) === timeZone) return
        await updateSettings({ locale, time_zone: timeZone })
      } catch {
        // Emails fall back to English and UTC; try again on the next change.
        synced.current = null
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, locale])

  return null
}
