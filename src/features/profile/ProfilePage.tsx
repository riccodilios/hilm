import { useQuery } from '@tanstack/react-query'
import { Activity, BookOpen, Lightbulb, Settings, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getProfile, settingsKeys } from '@/features/settings/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader, Skeleton } from '@/components/ui/page'

const links = [
  { to: '/settings', label: 'Settings', description: 'Profile, theme, and AI provider preferences.', icon: Settings },
  { to: '/daily-log', label: 'Daily log', description: 'Capture progress, wins, and blockers.', icon: BookOpen },
  { to: '/activity', label: 'Activity', description: 'Review the recent history of your workspace.', icon: Activity },
  { to: '/ideas', label: 'Ideas', description: 'Explore and prioritize ideas (coming soon).', icon: Lightbulb },
]

export function ProfilePage() {
  const profile = useQuery({ queryKey: settingsKeys.profile(), queryFn: getProfile })

  if (profile.isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-52" /><Skeleton className="h-48" /></div>

  const name = profile.data?.display_name || 'Hilm user'
  return (
    <div>
      <PageHeader title="Profile" description="Your personal workspace at a glance." />
      <Card className="mb-6">
        <CardContent className="flex items-center gap-4 p-6">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-accent/15 text-accent"><UserRound className="size-7" /></span>
          <div>
            <h2 className="text-lg font-medium">{name}</h2>
            <p className="text-sm text-muted">Personal OS member</p>
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
