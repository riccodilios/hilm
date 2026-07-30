import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, LogOut, Save } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { getProfile, getSettings, settingsKeys, updateProfile, updateSettings } from '@/features/settings/api'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useTheme } from '@/hooks/useTheme'
import { REMINDER_OPTIONS, type ReminderType } from '@/features/tasks/reminders'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import {
  syncPushPreference,
  isWebPushSupported,
  getVapidPublicKey,
  getLocalPushStatus,
  sendTestNotification,
  getPushBlockerReason,
} from '@/features/notifications/push'
import { syncUnsentReminderChannels } from '@/features/notifications/api'

export function SettingsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: settingsKeys.me(), queryFn: getSettings })
  const profile = useQuery({ queryKey: settingsKeys.profile(), queryFn: getProfile })
  const projects = useQuery({ queryKey: projectsKeys.list(), queryFn: listProjects })
  const [displayName, setDisplayName] = useState('')
  const [emailReminders, setEmailReminders] = useState(true)
  const [pushNotifications, setPushNotifications] = useState(false)
  const [defaultReminder, setDefaultReminder] = useState<ReminderType>('1h')
  const [startupMode, setStartupMode] = useState<'personal' | 'workspace'>('personal')
  const [projectEmail, setProjectEmail] = useState<Record<string, boolean>>({})

  const [pushBusy, setPushBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [deviceStatus, setDeviceStatus] = useState<string>('')

  async function refreshDeviceStatus() {
    try {
      const blocker = getPushBlockerReason()
      if (blocker === 'ios_homescreen') {
        setDeviceStatus(t('settings.pushIosHomescreen'))
        return
      }
      if (blocker === 'unsupported') {
        setDeviceStatus(t('settings.pushUnsupported'))
        return
      }
      const status = await getLocalPushStatus()
      if (status.serverSubscription) setDeviceStatus(t('settings.pushDeviceReady'))
      else if (status.permission === 'denied') setDeviceStatus(t('settings.pushPermissionDenied'))
      else setDeviceStatus(t('settings.pushDeviceMissing'))
    } catch {
      setDeviceStatus('')
    }
  }

  useEffect(() => {
    void refreshDeviceStatus()
  }, [t])

  useEffect(() => {
    if (profile.data) setDisplayName(profile.data.display_name ?? '')
  }, [profile.data])

  useEffect(() => {
    if (settings.data?.theme === 'light' || settings.data?.theme === 'dark') {
      setTheme(settings.data.theme)
    }
    if (settings.data) {
      setEmailReminders(settings.data.email_reminders_enabled ?? true)
      setPushNotifications(settings.data.push_notifications_enabled ?? false)
      setDefaultReminder((settings.data.default_reminder_type as ReminderType) ?? '1h')
      setStartupMode(settings.data.default_startup_mode ?? 'personal')
    }
  }, [settings.data, setTheme])

  async function handlePushToggle(checked: boolean) {
    setPushBusy(true)
    try {
      if (checked) {
        if (!isWebPushSupported()) {
          toast.error(t('settings.pushUnsupported'))
          return
        }
        if (!getVapidPublicKey()) {
          toast.error(t('settings.pushMissingKey'))
          return
        }
        await syncPushPreference(true)
        await updateSettings({
          push_notifications_enabled: true,
          notification_prefs: {
            email_reminders: emailReminders,
            push_notifications: true,
            default_reminder_type: defaultReminder,
          },
        })
        await syncUnsentReminderChannels()
        setPushNotifications(true)
        await queryClient.invalidateQueries({ queryKey: settingsKeys.all })
        await refreshDeviceStatus()
        toast.success(t('settings.pushEnabled'))
      } else {
        await syncPushPreference(false)
        await updateSettings({
          push_notifications_enabled: false,
          notification_prefs: {
            email_reminders: emailReminders,
            push_notifications: false,
            default_reminder_type: defaultReminder,
          },
        })
        await syncUnsentReminderChannels()
        setPushNotifications(false)
        await queryClient.invalidateQueries({ queryKey: settingsKeys.all })
        await refreshDeviceStatus()
        toast.success(t('settings.pushDisabled'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.pushFailed'))
      setPushNotifications(false)
      await refreshDeviceStatus()
    } finally {
      setPushBusy(false)
    }
  }

  async function handleTestNotification() {
    setTestBusy(true)
    try {
      const result = await sendTestNotification()
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
      if (result.pushed && result.pushed > 0) toast.success(t('settings.testPushOk'))
      else toast.message(t('settings.testInAppOk'), { description: result.hint })
      await refreshDeviceStatus()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.testFailed'))
    } finally {
      setTestBusy(false)
    }
  }

  useEffect(() => {
    async function loadProjectPrefs() {
      if (!projects.data?.length) return
      const userId = await requireUserId()
      const { data } = await supabase
        .from('project_notification_prefs')
        .select('project_id, email_reminders')
        .eq('user_id', userId)
      const map: Record<string, boolean> = {}
      for (const p of projects.data) map[p.id] = true
      for (const row of data ?? []) map[row.project_id] = row.email_reminders
      setProjectEmail(map)
    }
    void loadProjectPrefs()
  }, [projects.data])

  const save = useMutation({
    mutationFn: async () => {
      const userId = await requireUserId()
      await Promise.all([
        updateSettings({
          theme,
          email_reminders_enabled: emailReminders,
          push_notifications_enabled: pushNotifications,
          default_reminder_type: defaultReminder,
          default_startup_mode: startupMode,
          notification_prefs: {
            email_reminders: emailReminders,
            push_notifications: pushNotifications,
            default_reminder_type: defaultReminder,
          },
        }),
        updateProfile({ display_name: displayName.trim() || undefined }),
        ...Object.entries(projectEmail).map(([projectId, enabled]) =>
          supabase.from('project_notification_prefs').upsert(
            {
              user_id: userId,
              project_id: projectId,
              email_reminders: enabled,
              push_notifications: pushNotifications,
              in_app_notifications: true,
            },
            { onConflict: 'user_id,project_id' },
          ),
        ),
      ])
      await syncUnsentReminderChannels()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settingsKeys.all })
      toast.success(t('settings.saved'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const logout = useMutation({
    mutationFn: async () => {
      await signOut()
    },
    onSuccess: () => {
      queryClient.clear()
      toast.success(t('settings.signedOut'))
      navigate('/login', { replace: true })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (settings.isLoading || profile.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-80" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <form
        className="max-w-2xl space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.appearance')}</CardTitle>
            <CardDescription>{t('settings.appearanceDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-border-subtle bg-surface-2/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t('settings.theme')}</p>
                  <p className="text-xs text-muted">{t('settings.themeDesc')}</p>
                </div>
                <ThemeToggle />
              </div>
            </div>
            <div className="rounded-2xl border border-border-subtle bg-surface-2/40 p-4">
              <div className="mb-3">
                <p className="text-sm font-medium">{t('settings.language')}</p>
                <p className="text-xs text-muted">{t('settings.languageDesc')}</p>
              </div>
              <LanguageSwitcher />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.startup')}</CardTitle>
            <CardDescription>{t('settings.startupDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(['personal', 'workspace'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setStartupMode(mode)}
                className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-start transition ${
                  startupMode === mode
                    ? 'border-accent/40 bg-accent/10'
                    : 'border-border-subtle bg-surface-2/40'
                }`}
              >
                <span
                  className={`mt-1 size-2.5 rounded-full ${
                    startupMode === mode ? 'bg-accent' : 'bg-muted'
                  }`}
                />
                <span>
                  <span className="block text-sm font-medium">
                    {mode === 'personal' ? t('os.personal') : t('os.workspace')}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {mode === 'personal' ? t('settings.startupPersonal') : t('settings.startupWorkspace')}
                  </span>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.notifications')}</CardTitle>
            <CardDescription>{t('settings.notificationsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{t('settings.emailReminders')}</p>
                <p className="text-xs text-muted">{t('settings.emailRemindersDesc')}</p>
              </div>
              <Switch checked={emailReminders} onCheckedChange={setEmailReminders} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{t('settings.pushNotifications')}</p>
                <p className="text-xs text-muted">{t('settings.pushNotificationsDesc')}</p>
                {deviceStatus ? <p className="mt-1 text-xs text-muted">{deviceStatus}</p> : null}
              </div>
              <Switch
                checked={pushNotifications}
                disabled={pushBusy}
                onCheckedChange={(checked) => void handlePushToggle(checked)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={testBusy}
              onClick={() => void handleTestNotification()}
            >
              {testBusy ? t('common.loading') : t('settings.testNotification')}
            </Button>
            <div className="space-y-2">
              <Label htmlFor="default-reminder">{t('settings.defaultReminder')}</Label>
              <select
                id="default-reminder"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                value={defaultReminder}
                onChange={(e) => setDefaultReminder(e.target.value as ReminderType)}
              >
                {REMINDER_OPTIONS.filter((o) => o.value !== 'custom').map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            {projects.data?.length ? (
              <div className="rounded-2xl border border-border-subtle p-4">
                <p className="mb-3 text-sm font-medium">{t('settings.perProject')}</p>
                <div className="space-y-3">
                  {projects.data.map((project) => (
                    <div key={project.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm">{project.name}</span>
                      <Switch
                        checked={projectEmail[project.id] ?? true}
                        onCheckedChange={(checked) =>
                          setProjectEmail((prev) => ({ ...prev, [project.id]: checked }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.profile')}</CardTitle>
            <CardDescription>{t('settings.profileDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="display-name">{t('settings.displayName')}</Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.data')}</CardTitle>
            <CardDescription>{t('settings.dataDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild type="button" variant="secondary">
              <Link to="/personal/export">
                <Download className="size-4" /> {t('settings.export')}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.account')}</CardTitle>
            <CardDescription>{t('settings.accountDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
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

        <Button type="submit" disabled={save.isPending}>
          <Save className="size-4" /> {t('common.save')}
        </Button>
      </form>
    </div>
  )
}
