import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { resolvePostAuthDestination, type PostAuthDestination } from '@/features/auth/startup'
import { Skeleton } from '@/components/ui/page'

/** Redirect authenticated users from login/signup to the correct OS entry. */
export function PostAuthRedirect() {
  const [to, setTo] = useState<PostAuthDestination | null>(null)

  useEffect(() => {
    void resolvePostAuthDestination().then(setTo)
  }, [])

  if (!to) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Skeleton className="h-10 w-40" />
      </div>
    )
  }

  return <Navigate to={to} replace />
}
