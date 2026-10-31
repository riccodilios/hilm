import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { resolvePostAuthDestination, type PostAuthDestination } from '@/features/auth/startup'
import { Skeleton } from '@/components/ui/page'

/** Redirect authenticated users from login/signup to the correct OS entry. */
export function PostAuthRedirect() {
  const [to, setTo] = useState<PostAuthDestination | null>(null)

  useEffect(() => {
    // Most people land on Personal home: fetch its code while the settings decide the destination.
    void import('@/features/home/HomePage').catch(() => undefined)
    void resolvePostAuthDestination().then(setTo)
  }, [])

  if (!to) return <PostAuthPending />

  return <Navigate to={to} replace />
}

export function PostAuthPending() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Skeleton className="h-10 w-40" />
    </div>
  )
}
