import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchSettings, settingsKeys, updateSettings } from '@/features/settings/api'
import { supabase } from '@/lib/supabase/client'

/** updateUser holds the auth lock that every data request waits on, so stay out of the first load. */
const SYNC_DELAY_MS = 4000

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
  const queryClient = useQueryClient()
  const locale = i18n.language?.startsWith('ar') ? 'ar' : 'en'
  const userId = user?.id ?? null
  const metadataLocale = user?.user_metadata?.locale as string | undefined
  const synced = useRef<string | null>(null)

  useEffect(() => {
    if (!userId) {
      synced.current = null
      return
    }
    const timeZone = deviceTimeZone()
    const key = `${userId}|${locale}|${timeZone ?? ''}`
    if (synced.current === key) return

    const timer = window.setTimeout(() => {
      synced.current = key
      void (async () => {
        try {
          // Auth emails (verification, password reset) read the language from user metadata.
          if (metadataLocale !== locale) {
            await supabase.auth.updateUser({ data: { locale } })
          }
          const settings = await fetchSettings()
          if (settings.locale === locale && (settings.time_zone ?? null) === timeZone) return
          await updateSettings({ locale, time_zone: timeZone })
          void queryClient.invalidateQueries({ queryKey: settingsKeys.me() })
        } catch {
          // Emails fall back to English and UTC; try again on the next change.
          if (synced.current === key) synced.current = null
        }
      })()
    }, SYNC_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [userId, locale, metadataLocale, queryClient])

  return null
}
