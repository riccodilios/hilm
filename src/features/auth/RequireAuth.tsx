import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { Skeleton } from '@/components/ui/page'
import { rememberPendingInvite } from '@/features/auth/pending-invite'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="w-full max-w-sm space-y-3 px-6">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    )
  }

  if (!user) {
    // Emailed invite links (/workspace?join=CODE) must survive sign-in or sign-up.
    if (location.pathname === '/workspace') {
      const join = new URLSearchParams(location.search).get('join')
      if (join && join !== '1') rememberPendingInvite(join)
    }
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
