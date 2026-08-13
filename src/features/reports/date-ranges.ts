import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import type { DateRangePreset } from '@/features/reports/types'
import { todayLocalISO, toLocalDateKey } from '@/lib/dates'
import i18n from '@/i18n'

export type ResolvedPeriod = {
  start: string
  end: string
  label: string
}

export function resolveReportPeriod(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
  now = new Date(),
  locale: 'en' | 'ar' = 'en',
): ResolvedPeriod {
  const today = todayLocalISO()
  const t = i18n.getFixedT(locale)
  const dateLocale = locale === 'ar' ? ar : enUS

  if (preset === 'custom' && customStart && customEnd) {
    return {
      start: customStart,
      end: customEnd,
      label: `${customStart} → ${customEnd}`,
    }
  }

  switch (preset) {
    case 'today':
      return {
        start: today,
        end: today,
        label: t('reports.period.today', { date: today }),
      }
    case 'yesterday': {
      const y = toLocalDateKey(subDays(now, 1))!
      return {
        start: y,
        end: y,
        label: t('reports.period.yesterday', { date: y }),
      }
    }
    case 'this_week': {
      const start = toLocalDateKey(startOfWeek(now, { weekStartsOn: 1 }))!
      const end = toLocalDateKey(endOfWeek(now, { weekStartsOn: 1 }))!
      return {
        start,
        end,
        label: t('reports.period.thisWeek', { start, end }),
      }
    }
    case 'last_week': {
      const anchor = subWeeks(now, 1)
      const start = toLocalDateKey(startOfWeek(anchor, { weekStartsOn: 1 }))!
      const end = toLocalDateKey(endOfWeek(anchor, { weekStartsOn: 1 }))!
      return {
        start,
        end,
        label: t('reports.period.lastWeek', { start, end }),
      }
    }
    case 'this_month': {
      const start = toLocalDateKey(startOfMonth(now))!
      const end = toLocalDateKey(endOfMonth(now))!
      return {
        start,
        end,
        label: format(now, 'MMMM yyyy', { locale: dateLocale }),
      }
    }
    case 'last_month': {
      const anchor = subMonths(now, 1)
      const start = toLocalDateKey(startOfMonth(anchor))!
      const end = toLocalDateKey(endOfMonth(anchor))!
      return {
        start,
        end,
        label: format(anchor, 'MMMM yyyy', { locale: dateLocale }),
      }
    }
    default: {
      const start = toLocalDateKey(addDays(now, -6))!
      return {
        start,
        end: today,
        label: t('reports.period.last7Days', { start, end: today }),
      }
    }
  }
}
