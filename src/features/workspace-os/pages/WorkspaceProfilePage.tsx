import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  Bell,
  Brain,
  Building2,
  Crosshair,
  FileText,
  LogOut,
  Network,
  Palette,
  Settings,
  Shield,
  UserRound,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/AuthProvider'
import { getSettings, settingsKeys, updateSettings } from '@/shared/user-settings'
import { getProfile, profileKeys, updateProfile } from '@/shared/user-profile'
import {
  getWorkspaceMemberSettings,
  upsertWorkspaceMemberSettings,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { listDepartments, orgKeys } from '@/features/workspace-os/org-api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
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
  const { workspaceId, workspace, role } = useWorkspace()

  const profile = useQuery({ queryKey: profileKeys.me(), queryFn: getProfile })
  const accountSettings = useQuery({ queryKey: settingsKeys.me(), queryFn: getSettings })
  const memberSettings = useQuery({
    queryKey: workspaceKeys.memberSettings(workspaceId),
    queryFn: () => getWorkspaceMemberSettings(workspaceId),
  })
  const departments = useQuery({
    queryKey: orgKeys.departments(workspaceId),
    queryFn: () => listDepartments(workspaceId),
  })

  const [displayOverride, setDisplayOverride] = useState('')
  const [accountDisplayName, setAccountDisplayName] = useState('')
  const [hidePersonalOs, setHidePersonalOs] = useState(false)
  const [homeDepartmentId, setHomeDepartmentId] = useState('')
  const [notifyTasks, setNotifyTasks] = useState(true)
  const [notifyMentions, setNotifyMentions] = useState(true)
  const [workspaceEmails, setWorkspaceEmails] = useState(true)
  const [compactUi, setCompactUi] = useState(false)
  const [aiSuggestAssign, setAiSuggestAssign] = useState(true)

  useEffect(() => {
    const settings = memberSettings.data
    setDisplayOverride(settings?.display_name_override ?? '')
    setHomeDepartmentId(settings?.department_id ?? '')
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
    setWorkspaceEmails(accountSettings.data?.email_workspace_enabled ?? true)
  }, [accountSettings.data])

  const accountName = profile.data?.display_name || t('brand.name')
  const workspaceDisplay =
    displayOverride.trim() || accountName

  const roleLabel = useMemo(() => t(`workspace.roles.${role}`, { defaultValue: role }), [role, t])

  const hubLinks = [
    {
      to: `/workspace/${workspaceId}/settings`,
      label: t('workspace.settingsPage.cardTitle'),
      description: t('workspace.settingsPage.cardDesc'),
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
      icon: Network,
    },
    {
      to: `/workspace/${workspaceId}/crm`,
      label: t('workspace.crmTitle'),
      description: t('workspace.crmDesc'),
      icon: Building2,
    },
    {
      to: `/workspace/${workspaceId}/reports`,
      label: t('workspace.reportsTitle'),
      description: t('workspace.reportsDesc'),
      icon: BarChart3,
    },
    {
      to: `/workspace/${workspaceId}/activity`,
      label: t('workspace.activity'),
      description: t('workspace.activityDesc'),
      icon: FileText,
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
          departmentId: homeDepartmentId || null,
        }),
        updateProfile({ display_name: accountDisplayName.trim() || undefined }),
        updateSettings({ hide_personal_os: hidePersonalOs, email_workspace_enabled: workspaceEmails }),
      ])
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: workspaceKeys.memberSettings(workspaceId) }),
        qc.invalidateQueries({ queryKey: settingsKeys.all }),
        qc.invalidateQueries({ queryKey: profileKeys.me() }),
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
          <div className="min-w-0 flex-1 basis-[11rem]">
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

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            <div>
              <Label htmlFor="ws-home-dept">{t('workspace.homeDepartment')}</Label>
              <select
                id="ws-home-dept"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                value={homeDepartmentId}
                onChange={(e) => setHomeDepartmentId(e.target.value)}
              >
                <option value="">{t('workspace.noHomeDepartment')}</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">{t('workspace.homeDepartmentHint')}</p>
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
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                {t('settings.workspaceEmails')}
                <span className="block text-xs text-muted">{t('settings.workspaceEmailsDesc')}</span>
              </span>
              <input
                type="checkbox"
                checked={workspaceEmails}
                onChange={(e) => setWorkspaceEmails(e.target.checked)}
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
    </div>
  )
}
