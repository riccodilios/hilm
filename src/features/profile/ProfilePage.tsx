import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Activity, Bell, BookOpen, Lightbulb, Settings, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getProfile, settingsKeys } from '@/features/settings/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader, Skeleton } from '@/components/ui/page'

export function ProfilePage() {
  const { t } = useTranslation()
  const profile = useQuery({ queryKey: settingsKeys.profile(), queryFn: getProfile })
  const links = [
    { to: '/app/settings', label: t('profile.settings'), description: t('profile.settingsDesc'), icon: Settings },
    { to: '/app/notifications', label: t('nav.notifications'), description: t('settings.notificationsDesc'), icon: Bell },
    { to: '/app/daily-log', label: t('profile.dailyLog'), description: t('profile.dailyLogDesc'), icon: BookOpen },
    { to: '/app/activity', label: t('profile.activity'), description: t('profile.activityDesc'), icon: Activity },
    { to: '/app/ideas', label: t('profile.ideas'), description: t('profile.ideasDesc'), icon: Lightbulb },
  ]

  if (profile.isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-52" /><Skeleton className="h-48" /></div>

  const name = profile.data?.display_name || t('brand.name')
  return (
    <div>
      <PageHeader title={t('profile.title')} description={t('profile.settingsDesc')} />
      <Card className="mb-6">
        <CardContent className="flex items-center gap-4 p-6">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-accent/15 text-accent"><UserRound className="size-7" /></span>
          <div>
            <h2 className="text-lg font-medium">{name}</h2>
            <p className="text-sm text-muted">{t('brand.tagline')}</p>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {links.map(({ to, label, description, icon: Icon }) => (
          <Link key={to} to={to}>
            <Card className="h-full transition-colors hover:border-border hover:bg-surface">
              <CardHeader className="flex-row items-center gap-3">
                <Icon className="size-4 text-accent" />
                <CardTitle>{label}</CardTitle>
              </CardHeader>
              <CardContent><CardDescription>{description}</CardDescription></CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
