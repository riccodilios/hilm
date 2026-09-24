import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export function AiAmbientBackground({
  intensity = 0.35,
  className,
}: {
  intensity?: number
  className?: string
}) {
  const clamped = Math.max(0.2, Math.min(1, intensity))
  return (
    <div
      className={cn('pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]', className)}
      aria-hidden
      style={{ ['--ai-ambient' as string]: String(clamped) } as CSSProperties}
    >
      <div className="ai-ambient-layer ai-ambient-a" />
      <div className="ai-ambient-layer ai-ambient-b" />
      <div className="ai-ambient-layer ai-ambient-c" />
    </div>
  )
}
