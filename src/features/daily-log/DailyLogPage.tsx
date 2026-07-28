import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dailyLogKeys, getDailyLog, upsertDailyLog } from '@/features/daily-log/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { todayISO } from '@/lib/utils'

type LogForm = { workedOn: string; blockers: string; hours: string; wins: string; tomorrow: string }
const emptyForm: LogForm = { workedOn: '', blockers: '', hours: '', wins: '', tomorrow: '' }

export function DailyLogPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const date = todayISO()
  const [form, setForm] = useState<LogForm>(emptyForm)
  const { data: log, isLoading } = useQuery({ queryKey: dailyLogKeys.byDate(date), queryFn: () => getDailyLog(date) })
  useEffect(() => { if (log) setForm({ workedOn: log.worked_on ?? '', blockers: log.blockers ?? '', hours: log.hours?.toString() ?? '', wins: log.wins ?? '', tomorrow: log.tomorrow ?? '' }) }, [log])
  const save = useMutation({
    mutationFn: () => upsertDailyLog({ logDate: date, workedOn: form.workedOn, blockers: form.blockers, hours: form.hours ? Number(form.hours) : null, wins: form.wins, tomorrow: form.tomorrow }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: dailyLogKeys.all }); toast.success(t('dailyLog.saved')) },
    onError: (error: Error) => toast.error(error.message),
  })
  if (isLoading) return <Skeleton className="h-96" />
  const update = (field: keyof LogForm) => (event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setForm((current) => ({ ...current, [field]: event.target.value }))
  return <div className="mx-auto max-w-3xl"><PageHeader title={t('dailyLog.title')} description={t('dailyLog.description')} /><Card><CardContent className="space-y-5 pt-5"><div className="space-y-2"><Label htmlFor="worked">{t('dailyLog.workedOn')}</Label><Textarea id="worked" value={form.workedOn} onChange={update('workedOn')} rows={4} /></div><div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="wins">{t('dailyLog.wins')}</Label><Textarea id="wins" value={form.wins} onChange={update('wins')} rows={4} /></div><div className="space-y-2"><Label htmlFor="blockers">{t('dailyLog.blockers')}</Label><Textarea id="blockers" value={form.blockers} onChange={update('blockers')} rows={4} /></div></div><div className="grid gap-5 sm:grid-cols-[1fr_10rem]"><div className="space-y-2"><Label htmlFor="tomorrow">{t('dailyLog.tomorrow')}</Label><Textarea id="tomorrow" value={form.tomorrow} onChange={update('tomorrow')} rows={3} /></div><div className="space-y-2"><Label htmlFor="hours">{t('dailyLog.hours')}</Label><Input id="hours" type="number" min="0" step="0.25" value={form.hours} onChange={update('hours')} /></div></div><Button onClick={() => save.mutate()} disabled={save.isPending}>{t('dailyLog.saved')}</Button></CardContent></Card></div>
}
