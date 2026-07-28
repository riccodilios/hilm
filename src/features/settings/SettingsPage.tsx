import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Save } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { getProfile, getSettings, settingsKeys, updateProfile, updateSettings } from '@/features/settings/api'
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

export function SettingsPage() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: settingsKeys.me(), queryFn: getSettings })
  const profile = useQuery({ queryKey: settingsKeys.profile(), queryFn: getProfile })
  const projects = useQuery({ queryKey: projectsKeys.list(), queryFn: listProjects })
  const [displayName, setDisplayName] = useState('')
  const [emailReminders, setEmailReminders] = useState(true)
  const [pushNotifications, setPushNotifications] = useState(false)
  const [defaultReminder, setDefaultReminder] = useState<ReminderType>('1h')
  const [projectEmail, setProjectEmail] = useState<Record<string, boolean>>({})

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
    }
  }, [settings.data, setTheme])

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
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settingsKeys.all })
      toast.success(t('settings.saved'))
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
              </div>
              <Switch checked={pushNotifications} onCheckedChange={setPushNotifications} />
            </div>
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
              <Link to="/app/export">
                <Download className="size-4" /> {t('settings.export')}
              </Link>
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
