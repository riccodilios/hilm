import { useTranslation } from 'react-i18next'
import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

const points = [
  'encrypted',
  'storage',
  'privateAi',
  'offline',
  'owned',
]

export function SecuritySection() {
  const { t } = useTranslation()

  return (
    <Section className="bg-surface/40">
      <FadeIn>
        <SectionHeading
          eyebrow={t('landing.securityEyebrow')}
          title={t('landing.securityTitle')}
          description={t('landing.securityDescription')}
        />
      </FadeIn>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {points.map((point, i) => (
          <FadeIn key={point} delay={i * 0.05}>
            <div className="h-full border-t border-border pt-5">
              <h3 className="text-base font-medium tracking-tight">{t(`landing.security.${point}.title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(`landing.security.${point}.body`)}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </Section>
  )
}
