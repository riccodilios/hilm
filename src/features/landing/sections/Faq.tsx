import { useTranslation } from 'react-i18next'
import { Section, SectionHeading } from '@/features/landing/primitives'

export function LandingFaqSection() {
  const { t } = useTranslation()
  const items = t('landing.faqItems', { returnObjects: true }) as Array<{
    q: string
    a: string
  }>

  return (
    <Section id="faq" className="border-t border-border-subtle">
      <SectionHeading
        eyebrow={t('landing.faqEyebrow')}
        title={t('landing.faqTitle')}
        description={t('landing.faqDescription')}
      />
      <div className="mx-auto max-w-3xl space-y-6">
        {(Array.isArray(items) ? items : []).map((item) => (
          <article key={item.q} className="border-b border-border-subtle pb-6 last:border-0">
            <h3 className="text-base font-medium tracking-tight text-foreground sm:text-lg">{item.q}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">{item.a}</p>
          </article>
        ))}
      </div>
    </Section>
  )
}
