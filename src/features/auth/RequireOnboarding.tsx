import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSettings, settingsKeys } from '@/features/settings/api'
import { WhatsNewGate } from '@/features/announcements/WhatsNewGate'
import { Skeleton } from '@/components/ui/page'

/** Ensures onboarding is finished before entering Personal or Workspace OS. */
export function RequireOnboarding() {
  const location = useLocation()
  const qc = useQueryClient()
  const settings = useQuery({
    queryKey: settingsKeys.me(),
    queryFn: getSettings,
  })

  // Opening the Personal home: load the dashboard while the settings check runs, not after it.
  useEffect(() => {
    if (location.pathname !== '/personal') return
    void import('@/features/home/api').then(({ getDashboardData, homeKeys }) =>
      qc.prefetchQuery({ queryKey: homeKeys.dashboard(), queryFn: getDashboardData, staleTime: 30_000 }),
    )
    // Only on first mount: later navigations are handled by the page itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
