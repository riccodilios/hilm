import { cn } from '@/lib/utils'

export function LandingSkeleton() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="h-6 w-16 animate-pulse rounded bg-surface-2" />
        <div className="h-9 w-28 animate-pulse rounded-lg bg-surface-2" />
      </div>
      <div className="mx-auto flex min-h-[70dvh] max-w-4xl flex-col items-center justify-center gap-5 px-5">
        <div className="h-16 w-48 animate-pulse rounded-xl bg-surface-2 sm:h-20 sm:w-64" />
        <div className="h-6 w-72 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-4 w-full max-w-lg animate-pulse rounded bg-surface-2" />
        <div className="mt-4 flex gap-3">
          <div className="h-11 w-32 animate-pulse rounded-xl bg-surface-2" />
          <div className="h-11 w-32 animate-pulse rounded-xl bg-surface-2" />
        </div>
      </div>
    </div>
  )
}

export function SectionSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('mx-auto max-w-6xl px-5 py-20', className)}>
      <div className="mb-10 h-8 w-48 animate-pulse rounded-lg bg-surface-2" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-36 animate-pulse rounded-2xl bg-surface-2" />
        ))}
      </div>
    </div>
  )
}
