import { useMemo } from 'react'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { getSettings, settingsKeys } from '@/features/settings/api'

export type TimeFormat = '12h' | '24h'

export function useTimeFormat(): TimeFormat {
  const settings = useQuery({ queryKey: settingsKeys.me(), queryFn: getSettings })
  return (settings.data?.time_format as TimeFormat | undefined) ?? '24h'
}

export function formatTimeValue(date: Date | string | number, timeFormat: TimeFormat) {
  const d = typeof date === 'object' && date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return '—'
  return format(d, timeFormat === '12h' ? 'h:mm a' : 'HH:mm')
}

export function formatHourLabel(hour: number, timeFormat: TimeFormat) {
  const whole = Math.floor(hour) % 24
  const minutes = Math.round((hour - Math.floor(hour)) * 60)
  const d = new Date()
  d.setHours(whole, minutes, 0, 0)
  return formatTimeValue(d, timeFormat)
}

export function formatDateTimeValue(date: Date | string | number, timeFormat: TimeFormat) {
  const d = typeof date === 'object' && date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return '—'
  return format(d, timeFormat === '12h' ? 'MMM d · h:mm a' : 'MMM d · HH:mm')
}

export function useFormatTime() {
  const timeFormat = useTimeFormat()
  return useMemo(
    () => ({
      timeFormat,
      formatTime: (date: Date | string | number) => formatTimeValue(date, timeFormat),
      formatHour: (hour: number) => formatHourLabel(hour, timeFormat),
      formatDateTime: (date: Date | string | number) => formatDateTimeValue(date, timeFormat),
    }),
    [timeFormat],
  )
}
