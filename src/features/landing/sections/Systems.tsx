import { useTranslation } from 'react-i18next'
import { Building2, UserRound } from 'lucide-react'
import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

export function SystemsSection() {
  const { t } = useTranslation()
  const personalPoints = t('landing.systems.personalPoints', { returnObjects: true }) as string[]
  const workspacePoints = t('landing.systems.workspacePoints', { returnObjects: true }) as string[]

  return (
    <Section className="bg-surface/35">
      <FadeIn>
        <SectionHeading
          eyebrow={t('landing.systemsEyebrow')}
          title={t('landing.systemsTitle')}
          description={t('landing.systemsDescription')}
        />
      </FadeIn>

      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <FadeIn>
          <article>
            <div className="mb-5 flex items-center gap-3">
              <UserRound className="size-5 text-muted" strokeWidth={1.5} />
              <h3 className="text-xl font-medium tracking-tight">{t('landing.systems.personalTitle')}</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted sm:text-base">
              {t('landing.systems.personalBody')}
            </p>
            <ul className="mt-6 space-y-3">
              {(Array.isArray(personalPoints) ? personalPoints : []).map((point) => (
                <li key={point} className="border-b border-border-subtle pb-3 text-sm text-foreground/90 sm:text-base">
                  {point}
                </li>
              ))}
            </ul>
          </article>
        </FadeIn>

        <FadeIn delay={0.08}>
          <article>
            <div className="mb-5 flex items-center gap-3">
              <Building2 className="size-5 text-muted" strokeWidth={1.5} />
              <h3 className="text-xl font-medium tracking-tight">{t('landing.systems.workspaceTitle')}</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted sm:text-base">
              {t('landing.systems.workspaceBody')}
            </p>
            <ul className="mt-6 space-y-3">
              {(Array.isArray(workspacePoints) ? workspacePoints : []).map((point) => (
                <li key={point} className="border-b border-border-subtle pb-3 text-sm text-foreground/90 sm:text-base">
                  {point}
                </li>
              ))}
            </ul>
          </article>
        </FadeIn>
      </div>
    </Section>
  )
}
