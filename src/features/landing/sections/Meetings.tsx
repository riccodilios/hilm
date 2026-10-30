import { Link } from 'react-router-dom'
import { ArrowRight, Mic } from 'lucide-react'
import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'
import { usePublicPage } from '@/features/landing/public/PublicPage'
import { rtlMirrorClass } from '@/lib/rtl'
import { cn } from '@/lib/utils'
import { HOME_CONTENT, publicPath } from '@/content/site.ts'

export function MeetingsSection() {
  const { locale } = usePublicPage()
  const copy = HOME_CONTENT[locale].meetings
  return (
    <Section id="meetings" className="border-t border-border-subtle">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <FadeIn>
          <SectionHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.body} className="mb-8 sm:mb-10" />
          <Link
            to={publicPath('meetings', locale)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            {copy.link} <ArrowRight className={cn('size-4', rtlMirrorClass(locale))} />
          </Link>
        </FadeIn>
        <FadeIn delay={0.08}>
          <ul className="space-y-3">
            {copy.points.map((point) => (
              <li
                key={point}
                className="flex items-start gap-3 border-b border-border-subtle pb-3 text-sm text-foreground/90 sm:text-base"
              >
                <Mic className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />
                {point}
              </li>
            ))}
          </ul>
        </FadeIn>
      </div>
    </Section>
  )
}
