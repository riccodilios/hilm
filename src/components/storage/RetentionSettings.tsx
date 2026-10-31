import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getRetentionInfo, setRetentionDays, UploadRejectedError } from '@/lib/storage/uploads'

/** Attachment retention for personal files (no workspaceId) or a workspace. */
export function RetentionSettings({ workspaceId }: { workspaceId?: string | null }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const key = ['storage-retention', workspaceId ? 'workspace' : 'personal', ...(workspaceId ? [workspaceId] : [])]
  const info = useQuery({ queryKey: key, queryFn: () => getRetentionInfo(workspaceId ?? null) })
  const [days, setDays] = useState('')

  useEffect(() => {
    if (info.data) setDays(info.data.retention_days == null ? '' : String(info.data.retention_days))
  }, [info.data])

  const save = useMutation({
    mutationFn: () => setRetentionDays(Number(days), workspaceId ?? null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['storage-retention'] })
      toast.success(t('retention.saved'))
    },
    onError: (error: unknown) => {
      if (error instanceof UploadRejectedError && error.code === 'out_of_range') {
        toast.error(t('retention.outOfRange', { min: 7, max: info.data?.max_days ?? 365 }))
      } else if (error instanceof UploadRejectedError && error.code === 'managed_by_platform') {
        toast.error(t('retention.managedByPlatform'))
      } else {
        toast.error(error instanceof Error ? error.message : t('attachments.errors.generic'))
      }
    },
  })

  if (!info.data) return null
  const data = info.data
  const parsed = Number(days)
  const valid = Number.isInteger(parsed) && parsed >= 7 && parsed <= data.max_days

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {data.retention_days == null
          ? t('retention.currentKeep')
          : t('retention.current', { days: data.retention_days, quarantine: data.quarantine_days })}
      </p>
      <p className="text-xs text-muted">{t('retention.audio')}</p>
      {data.legal_hold ? <p className="text-xs text-muted">{t('retention.legalHold')}</p> : null}
      {data.managed_by_platform ? (
        <p className="text-xs text-muted">{t('retention.managedByPlatform')}</p>
      ) : data.can_manage ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor={`retention-days-${workspaceId ?? 'me'}`}>{t('retention.daysLabel')}</Label>
            <Input
              id={`retention-days-${workspaceId ?? 'me'}`}
              type="number"
              min={7}
              max={data.max_days}
              className="mt-1"
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </div>
          <Button disabled={!valid || save.isPending || parsed === data.retention_days} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </div>
      ) : null}
      {data.can_manage && !data.managed_by_platform ? (
        <p className="text-[11px] text-muted">{t('retention.range', { min: 7, max: data.max_days })}</p>
      ) : null}
    </div>
  )
}
