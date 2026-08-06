import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Bot, Building2, Sparkles, Tag, User } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  ANNOUNCEMENT_TYPE_LABEL,
  type FeatureAnnouncement,
} from '@/features/announcements/catalog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function HeroIcon({ icon }: { icon: FeatureAnnouncement['icon'] }) {
  const className = 'size-5'
  switch (icon) {
    case 'tag':
      return <Tag className={className} />
    case 'workspace':
      return <Building2 className={className} />
    case 'personal':
      return <User className={className} />
    case 'ai':
      return <Bot className={className} />
    case 'sparkles':
    default:
      return <Sparkles className={className} />
  }
}

/**
 * Fixed What's New template — feature drops only.
 * Eyebrow → hero → title → description → highlights → CTAs.
 */
export function WhatsNewModal({
  announcement,
  onContinue,
  pending,
}: {
  announcement: FeatureAnnouncement
  onContinue: () => void
  pending?: boolean
}) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="presentation"
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="whats-new-title"
          className={cn(
            'w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl',
            'pb-[max(1rem,env(safe-area-inset-bottom))]',
          )}
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          <div
            className="relative h-40 overflow-hidden bg-surface-2"
            style={
              announcement.illustration
                ? {
                    backgroundImage: `url(${announcement.illustration})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
                : undefined
            }
          >
            {!announcement.illustration ? (
              <>
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_40%,color-mix(in_oklab,var(--accent)_28%,transparent),transparent_60%)]" />
                <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,var(--foreground)_1px,transparent_1px),linear-gradient(to_bottom,var(--foreground)_1px,transparent_1px)] [background-size:24px_24px]" />
              </>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent" />
            )}
            <div className="absolute bottom-4 start-5 flex size-12 items-center justify-center rounded-2xl border border-border bg-surface text-foreground">
              <HeroIcon icon={announcement.icon} />
            </div>
          </div>

          <div className="space-y-4 px-5 pb-5 pt-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted">
                What&apos;s New · {ANNOUNCEMENT_TYPE_LABEL[announcement.type]} · v
                {announcement.version}
              </p>
              <h2 id="whats-new-title" className="mt-1 text-2xl font-medium tracking-tight">
                {announcement.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{announcement.description}</p>
            </div>

            <ul className="space-y-2.5 rounded-xl border border-border-subtle bg-surface-2/40 p-3.5">
              {announcement.highlights.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm text-foreground/90">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1">
                {(announcement.secondaryCtas ?? []).map((cta) =>
                  cta.href ? (
                    <Button key={cta.label} asChild variant="ghost" size="sm">
                      <Link to={cta.href} onClick={onContinue}>
                        {cta.label}
                      </Link>
                    </Button>
                  ) : (
                    <Button key={cta.label} variant="ghost" size="sm" type="button">
                      {cta.label}
                    </Button>
                  ),
                )}
              </div>
              <Button onClick={onContinue} disabled={pending} className="w-full sm:w-auto">
                {announcement.primaryCta.label}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
