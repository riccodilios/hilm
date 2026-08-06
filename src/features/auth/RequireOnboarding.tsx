import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSettings, settingsKeys } from '@/features/settings/api'
import { WhatsNewGate } from '@/features/announcements/WhatsNewGate'
import { Skeleton } from '@/components/ui/page'

/** Ensures onboarding is finished before entering Personal or Workspace OS. */
export function RequireOnboarding() {
  const location = useLocation()
  const settings = useQuery({
    queryKey: settingsKeys.me(),
    queryFn: getSettings,
  })

  if (settings.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <Skeleton className="h-10 w-48" />
      </div>
    )
  }

  if (settings.data && !settings.data.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return (
    <WhatsNewGate>
      <Outlet />
    </WhatsNewGate>
  )
}
