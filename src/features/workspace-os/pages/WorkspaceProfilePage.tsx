import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Bell,
  Brain,
  Crosshair,
  LogOut,
  Palette,
  Settings,
  Shield,
  UserRound,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  getProfile,
  getSettings,
  settingsKeys,
  updateProfile,
  updateSettings,
} from '@/features/settings/api'
import {
  deleteWorkspace,
  getWorkspaceMemberSettings,
  leaveWorkspace,
  listWorkspaceMembers,
  regenerateInviteCode,
  transferOwnership,
  updateWorkspace,
  upsertWorkspaceMemberSettings,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { resolveMemberDisplayName } from '@/features/workspace-os/lib/member-display'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PageHeader, Skeleton } from '@/components/ui/page'

export function WorkspaceProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const qc = useQueryClient()
  const { workspaceId, workspace, role, canManage, canManageTeam, canDelete } = useWorkspace()

  const profile = useQuery({ queryKey: settingsKeys.profile(), queryFn: getProfile })
  const accountSettings = useQuery({ queryKey: settingsKeys.me(), queryFn: getSettings })
  const memberSettings = useQuery({
    queryKey: workspaceKeys.memberSettings(workspaceId),
    queryFn: () => getWorkspaceMemberSettings(workspaceId),
  })
  const members = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => listWorkspaceMembers(workspaceId),
    enabled: canManage || canDelete,
  })

  const [displayOverride, setDisplayOverride] = useState('')
  const [accountDisplayName, setAccountDisplayName] = useState('')
  const [hidePersonalOs, setHidePersonalOs] = useState(false)
  const [notifyTasks, setNotifyTasks] = useState(true)
  const [notifyMentions, setNotifyMentions] = useState(true)
  const [compactUi, setCompactUi] = useState(false)
  const [aiSuggestAssign, setAiSuggestAssign] = useState(true)
  const [wsName, setWsName] = useState(workspace.name)
  const [wsDescription, setWsDescription] = useState(workspace.description ?? '')
  const [wsColor, setWsColor] = useState(workspace.color)
  const [transferTo, setTransferTo] = useState('')

  useEffect(() => {
    const settings = memberSettings.data
    setDisplayOverride(settings?.display_name_override ?? '')
    const notifications = (settings?.notification_prefs ?? {}) as Record<string, unknown>
    const appearance = (settings?.appearance_prefs ?? {}) as Record<string, unknown>
    const ai = (settings?.ai_prefs ?? {}) as Record<string, unknown>
    setNotifyTasks(notifications.tasks !== false)
    setNotifyMentions(notifications.mentions !== false)
    setCompactUi(appearance.compact === true)
    setAiSuggestAssign(ai.suggestAssign !== false)
  }, [memberSettings.data])

  useEffect(() => {
    if (profile.data) setAccountDisplayName(profile.data.display_name ?? '')
  }, [profile.data])

  useEffect(() => {
    setHidePersonalOs(accountSettings.data?.hide_personal_os ?? false)
  }, [accountSettings.data])

  useEffect(() => {
    setWsName(workspace.name)
    setWsDescription(workspace.description ?? '')
    setWsColor(workspace.color)
  }, [workspace.name, workspace.description, workspace.color])

  const accountName = profile.data?.display_name || t('brand.name')
  const workspaceDisplay =
    displayOverride.trim() || accountName

  const roleLabel = useMemo(() => t(`workspace.roles.${role}`, { defaultValue: role }), [role, t])

  const hubLinks = [
    {
      to: `/workspace/${workspaceId}/account-settings`,
      label: t('workspace.personalSettings'),
      description: t('workspace.personalSettingsDesc'),
      icon: Settings,
    },
    {
      to: `/workspace/${workspaceId}/mission-control`,
      label: t('mission.title'),
      description: t('workspace.missionDesc'),
      icon: Crosshair,
    },
    {
      to: `/workspace/${workspaceId}/team-lead`,
      label: t('workspace.teamLeadTitle'),
      description: t('workspace.teamLeadDesc'),
      icon: Users,
    },
    {
      to: `/workspace/${workspaceId}/org`,
      label: t('workspace.orgTitle'),
      description: t('workspace.orgDesc'),
      icon: Crosshair,
    },
    {
      to: `/workspace/${workspaceId}/crm`,
      label: t('workspace.crmTitle'),
      description: t('workspace.crmDesc'),
      icon: Activity,
    },
    {
      to: `/workspace/${workspaceId}/reports`,
      label: t('workspace.reportsTitle'),
      description: t('workspace.reportsDesc'),
      icon: Activity,
    },
    {
      to: `/workspace/${workspaceId}/activity`,
      label: t('workspace.activity'),
      description: t('workspace.activityDesc'),
      icon: Activity,
    },
  ]

  const savePrefs = useMutation({
    mutationFn: async () => {
      await Promise.all([
        upsertWorkspaceMemberSettings(workspaceId, {
          displayNameOverride: displayOverride.trim() || null,
          notificationPrefs: { tasks: notifyTasks, mentions: notifyMentions },
          appearancePrefs: { compact: compactUi },
          aiPrefs: { suggestAssign: aiSuggestAssign },
        }),
        updateProfile({ display_name: accountDisplayName.trim() || undefined }),
        updateSettings({ hide_personal_os: hidePersonalOs }),
      ])
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: workspaceKeys.memberSettings(workspaceId) }),
        qc.invalidateQueries({ queryKey: settingsKeys.all }),
        qc.invalidateQueries({ queryKey: settingsKeys.profile() }),
      ])
      toast.success(t('workspace.profileSaved'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const logout = useMutation({
    mutationFn: async () => {
      await signOut()
    },
    onSuccess: () => {
      qc.clear()
      toast.success(t('settings.signedOut'))
      navigate('/login', { replace: true })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const saveWorkspace = useMutation({
    mutationFn: () =>
      updateWorkspace(workspaceId, {
        name: wsName,
        description: wsDescription || null,
        color: wsColor,
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

  if (profile.isLoading || memberSettings.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-52" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title={t('workspace.profileTitle')} description={t('workspace.profileDesc')} />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-4 p-6">
          <span
            className="flex size-14 items-center justify-center rounded-2xl text-lg font-medium text-background"
            style={{ backgroundColor: workspace.color }}
          >
            {(workspaceDisplay || workspace.name).slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-medium">{workspaceDisplay}</h2>
            <p className="text-sm text-muted">
              {workspace.name} · {roleLabel}
            </p>
            <p className="mt-1 text-xs text-muted">{t('workspace.profileAccount', { name: accountName })}</p>
          </div>
          <Button asChild variant="secondary">
            <Link to={`/workspace/${workspaceId}/account-settings`}>
              {t('workspace.personalSettings')}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {hubLinks.map(({ to, label, description, icon: Icon }) => (
          <Link key={to} to={to}>
            <Card className="h-full transition-colors hover:border-border hover:bg-surface">
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <Icon className="size-4 text-accent" />
                <CardTitle>{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{description}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('settings.account')}</CardTitle>
          <CardDescription>{t('workspace.accountDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="account-display">{t('settings.displayName')}</Label>
            <Input
              id="account-display"
              className="mt-1"
              value={accountDisplayName}
              onChange={(e) => setAccountDisplayName(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted">{t('workspace.accountNameHint')}</p>
          </div>
          {user?.email ? (
            <div className="rounded-xl border border-border-subtle bg-surface-2/40 px-3 py-2 text-sm">
              <p className="text-muted">{t('auth.email')}</p>
              <p className="font-medium">{user.email}</p>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{t('settings.hidePersonalOs')}</p>
              <p className="text-xs text-muted">{t('settings.hidePersonalOsDesc')}</p>
            </div>
            <Switch checked={hidePersonalOs} onCheckedChange={setHidePersonalOs} />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut className="size-4" /> {t('settings.signOut')}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <UserRound className="size-4 text-accent" />
            <div>
              <CardTitle>{t('workspace.profileIdentity')}</CardTitle>
              <CardDescription>{t('workspace.profileIdentityDesc')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="ws-display">{t('workspace.displayOverride')}</Label>
              <Input
                id="ws-display"
                className="mt-1"
                value={displayOverride}
                onChange={(e) => setDisplayOverride(e.target.value)}
                placeholder={accountName}
              />
            </div>
            <div className="rounded-xl border border-border-subtle bg-surface-2/40 px-3 py-2 text-sm">
              <p className="text-muted">{t('workspace.yourRole')}</p>
              <p className="font-medium">{roleLabel}</p>
            </div>
            <p className="text-xs text-muted">{t('workspace.permissionsHint', { role: roleLabel })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Bell className="size-4 text-accent" />
            <div>
              <CardTitle>{t('workspace.profileNotifications')}</CardTitle>
              <CardDescription>{t('workspace.profileNotificationsDesc')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('workspace.notifyTasks')}</span>
              <input type="checkbox" checked={notifyTasks} onChange={(e) => setNotifyTasks(e.target.checked)} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('workspace.notifyMentions')}</span>
              <input
                type="checkbox"
                checked={notifyMentions}
                onChange={(e) => setNotifyMentions(e.target.checked)}
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Palette className="size-4 text-accent" />
            <div>
              <CardTitle>{t('workspace.profileAppearance')}</CardTitle>
              <CardDescription>{t('workspace.profileAppearanceDesc')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('workspace.compactUi')}</span>
              <input type="checkbox" checked={compactUi} onChange={(e) => setCompactUi(e.target.checked)} />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Brain className="size-4 text-accent" />
            <div>
              <CardTitle>{t('workspace.profileAi')}</CardTitle>
              <CardDescription>{t('workspace.profileAiDesc')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('workspace.aiSuggestAssign')}</span>
              <input
                type="checkbox"
                checked={aiSuggestAssign}
                onChange={(e) => setAiSuggestAssign(e.target.checked)}
              />
            </label>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={savePrefs.isPending} onClick={() => savePrefs.mutate()}>
          {t('common.save')}
        </Button>
      </div>

      {canManage ? (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>{t('workspace.ownerSettings')}</CardTitle>
            <CardDescription>{t('workspace.settingsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="max-w-lg space-y-4">
            <div>
              <Label htmlFor="ws-name">{t('workspace.name')}</Label>
              <Input id="ws-name" className="mt-1" value={wsName} onChange={(e) => setWsName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ws-desc">{t('workspace.description')}</Label>
              <Input
                id="ws-desc"
                className="mt-1"
                value={wsDescription}
                onChange={(e) => setWsDescription(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ws-color">{t('workspace.color')}</Label>
              <Input
                id="ws-color"
                type="color"
                className="mt-1 h-10"
                value={wsColor}
                onChange={(e) => setWsColor(e.target.value)}
              />
            </div>
            <Button disabled={saveWorkspace.isPending || !wsName.trim()} onClick={() => saveWorkspace.mutate()}>
              {t('workspace.saveWorkspaceSettings')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canManageTeam ? (
        <Card className="mt-6">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Users className="size-4 text-accent" />
            <div>
              <CardTitle>{t('workspace.inviteManagement')}</CardTitle>
              <CardDescription>{t('workspace.teamDesc')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link to={`/workspace/${workspaceId}/team`}>{t('nav.team')}</Link>
            </Button>
            <Button variant="secondary" disabled={invite.isPending} onClick={() => invite.mutate()}>
              {t('workspace.regenerate')}
            </Button>
            <p className="w-full text-xs text-muted">
              {t('workspace.inviteCode')}: <span className="font-mono">{workspace.invite_code}</span>
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <Shield className="size-4 text-accent" />
          <div>
            <CardTitle>{t('workspace.security')}</CardTitle>
            <CardDescription>{t('workspace.securityDesc')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted">
          <p>{t('workspace.connectedAccounts')}</p>
          <p>{t('workspace.securityHint')}</p>
        </CardContent>
      </Card>

      {canDelete ? (
        <div className="mt-8 max-w-lg space-y-4 rounded-2xl border border-danger/30 bg-danger/5 p-4">
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
        <div className="mt-8 max-w-lg rounded-2xl border border-border-subtle p-4">
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
