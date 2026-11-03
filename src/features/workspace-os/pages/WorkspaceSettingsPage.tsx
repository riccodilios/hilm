import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Brain, HardDrive, LogOut, Settings, Users } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteWorkspace,
  getWorkspaceUsage,
  leaveWorkspace,
  listWorkspaceMembers,
  regenerateInviteCode,
  transferOwnership,
  updateWorkspace,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { resolveMemberDisplayName } from '@/features/workspace-os/lib/member-display'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { RetentionSettings } from '@/components/storage/RetentionSettings'
import { WorkspacePlanCard } from '@/shared/billing/WorkspacePlanCard'
import { billingKeys } from '@/shared/billing/api'

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-xl border border-border-subtle bg-surface/60 px-3 py-3">
      <p className="truncate text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-medium tabular-nums">{value}</p>
    </div>
  )
}

export function WorkspaceSettingsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { workspaceId, workspace, canManage, canManageTeam, canDelete } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description ?? '')
  const [color, setColor] = useState(workspace.color)
  const [transferTo, setTransferTo] = useState('')
  const number = new Intl.NumberFormat(i18n.language)

  useEffect(() => {
    setName(workspace.name)
    setDescription(workspace.description ?? '')
    setColor(workspace.color)
  }, [workspace.name, workspace.description, workspace.color])

  const usage = useQuery({
    queryKey: billingKeys.workspace(workspaceId),
    queryFn: () => getWorkspaceUsage(workspaceId),
    staleTime: 60_000,
  })

  const members = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => listWorkspaceMembers(workspaceId),
    enabled: canDelete,
  })

  const save = useMutation({
    mutationFn: () =>
      updateWorkspace(workspaceId, {
        name: name.trim(),
        description: description.trim() || null,
        color,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.list() })
      toast.success(t('workspace.settingsSaved'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const invite = useMutation({
    mutationFn: () => regenerateInviteCode(workspaceId),
    onSuccess: async (code) => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) })
      toast.success(t('workspace.inviteRegenerated', { code }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const transfer = useMutation({
    mutationFn: () => transferOwnership(workspaceId, transferTo),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) })
      toast.success(t('workspace.ownershipTransferred'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: () => deleteWorkspace(workspaceId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.list() })
      toast.success(t('workspace.deleted'))
      navigate('/workspace')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const leave = useMutation({
    mutationFn: () => leaveWorkspace(workspaceId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.list() })
      toast.success(t('workspace.left'))
      navigate('/workspace')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const data = usage.data
  const storage = data?.storage
  const storagePct =
    storage && storage.quota_bytes ? Math.min(100, Math.round((storage.used_bytes / storage.quota_bytes) * 100)) : 0

  return (
    <div className="w-full min-w-0 space-y-6">
      <PageHeader title={t('workspace.settingsPage.title')} description={t('workspace.settingsPage.desc')} />

      <WorkspacePlanCard workspaceId={workspaceId} usage={usage.data} />

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('workspace.settingsPage.usageTitle')}</CardTitle>
          <CardDescription>{t('workspace.settingsPage.usageDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {usage.isLoading ? (
            <Skeleton className="h-24" />
          ) : data?.ok ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label={t('workspace.settingsPage.members')} value={number.format(data.members)} />
                <Stat label={t('workspace.settingsPage.projects')} value={number.format(data.projects)} />
                <Stat label={t('workspace.settingsPage.openTasks')} value={number.format(data.tasks_open)} />
                <Stat label={t('workspace.settingsPage.doneTasks')} value={number.format(data.tasks_done)} />
                <Stat label={t('workspace.settingsPage.meetings')} value={number.format(data.meetings)} />
                <Stat
                  label={t('workspace.settingsPage.meetingMinutes')}
                  value={number.format(data.meeting_minutes_month)}
                />
              </div>

              {storage ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <HardDrive className="size-4 text-accent" /> {t('workspace.settingsPage.storage')}
                    </span>
                    <span className="tabular-nums text-muted">
                      {storage.quota_bytes
                        ? t('workspace.settingsPage.storageOf', {
                            used: formatBytes(storage.used_bytes),
                            quota: formatBytes(storage.quota_bytes),
                          })
                        : formatBytes(storage.used_bytes)}
                    </span>
                  </div>
                  {storage.quota_bytes ? (
                    <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className={`h-full rounded-full ${storagePct >= 90 ? 'bg-danger' : 'bg-accent/70'}`}
                        style={{ width: `${storagePct}%` }}
                      />
                    </div>
                  ) : null}
                  <p className="text-xs text-muted">
                    {t('workspace.settingsPage.storageBreakdown', {
                      files: number.format(storage.files),
                      attachments: formatBytes(storage.attachments_bytes),
                      audio: formatBytes(storage.audio_bytes),
                    })}
                  </p>
                </div>
              ) : null}

              {data.ai_month ? (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Brain className="size-4 text-accent" /> {t('workspace.settingsPage.aiTitle')}
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <Stat label={t('workspace.settingsPage.aiRequests')} value={number.format(data.ai_month.requests)} />
                    <Stat
                      label={t('workspace.settingsPage.aiMeetings')}
                      value={number.format(data.ai_month.meeting_requests)}
                    />
                    <Stat label={t('workspace.settingsPage.aiTokens')} value={number.format(data.ai_month.tokens)} />
                    <Stat label={t('workspace.settingsPage.aiCost')} value={`$${data.ai_month.cost_usd.toFixed(4)}`} />
                    <Stat label={t('workspace.settingsPage.aiUsers')} value={number.format(data.ai_month.active_users)} />
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted">{t('common.notFound')}</p>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <Settings className="size-4 text-accent" />
          <div>
            <CardTitle>{t('workspace.settingsPage.general')}</CardTitle>
            <CardDescription>{t('workspace.settingsDesc')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="max-w-lg space-y-4">
          <div>
            <Label htmlFor="ws-name">{t('workspace.name')}</Label>
            <Input id="ws-name" className="mt-1" value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ws-desc">{t('workspace.description')}</Label>
            <Input
              id="ws-desc"
              className="mt-1"
              value={description}
              disabled={!canManage}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ws-color">{t('workspace.color')}</Label>
            <Input
              id="ws-color"
              type="color"
              className="mt-1 h-10"
              value={color}
              disabled={!canManage}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          {canManage ? (
            <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>
              {t('workspace.saveWorkspaceSettings')}
            </Button>
          ) : (
            <p className="text-sm text-muted">{t('workspace.readOnlySettings')}</p>
          )}
        </CardContent>
      </Card>

      {canManageTeam ? (
        <Card className="min-w-0">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Users className="size-4 text-accent" />
            <div>
              <CardTitle>{t('workspace.settingsPage.invites')}</CardTitle>
              <CardDescription>{t('workspace.teamDesc')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              {t('workspace.inviteCode')}: <span className="font-mono">{workspace.invite_code}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link to={`/workspace/${workspaceId}/team`}>{t('nav.team')}</Link>
              </Button>
              <Button variant="secondary" disabled={invite.isPending} onClick={() => invite.mutate()}>
                {t('workspace.regenerate')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('retention.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <RetentionSettings workspaceId={workspaceId} />
        </CardContent>
      </Card>

      {canDelete ? (
        <div className="max-w-lg space-y-4 rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <h2 className="text-sm font-medium text-danger">{t('workspace.dangerZone')}</h2>
          <div>
            <Label>{t('workspace.transferOwnership')}</Label>
            <select
              className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm"
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
            >
              <option value="">{t('workspace.selectMember')}</option>
              {(members.data ?? [])
                .filter((m) => m.user_id !== user?.id)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {resolveMemberDisplayName({
                      displayNameOverride: m.display_name_override,
                      displayName: m.profiles?.display_name,
                      email: m.email ?? m.profiles?.email,
                    })}
                  </option>
                ))}
            </select>
            <Button
              className="mt-2"
              variant="secondary"
              disabled={!transferTo || transfer.isPending}
              onClick={() => transfer.mutate()}
            >
              {t('workspace.transfer')}
            </Button>
          </div>
          <Button
            variant="ghost"
            className="text-danger"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(t('workspace.deleteConfirm'))) remove.mutate()
            }}
          >
            {t('workspace.deleteWorkspace')}
          </Button>
        </div>
      ) : (
        <div className="max-w-lg rounded-2xl border border-border-subtle p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <LogOut className="size-4" /> {t('workspace.leaveWorkspace')}
          </h2>
          <p className="mb-3 text-sm text-muted">{t('workspace.leaveDesc')}</p>
          <Button
            variant="ghost"
            className="text-danger"
            disabled={leave.isPending}
            onClick={() => {
              if (window.confirm(t('workspace.leaveConfirm'))) leave.mutate()
            }}
          >
            {t('workspace.leaveWorkspace')}
          </Button>
        </div>
      )}
    </div>
  )
}
