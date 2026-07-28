import { useTranslation } from 'react-i18next'
import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

export function ProblemSection() {
  const { t } = useTranslation()
  const failures = t('landing.problemItems', { returnObjects: true }) as string[]

  return (
    <Section>
      <FadeIn>
        <SectionHeading
          eyebrow={t('landing.problemEyebrow')}
          title={t('landing.problemTitle')}
          description={t('landing.problemDescription')}
        />
      </FadeIn>

      <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
        <ul className="space-y-4">
          {failures.map((item, i) => (
            <FadeIn key={item} delay={i * 0.05}>
              <li className="flex gap-4 border-b border-border-subtle pb-4 text-base text-muted sm:text-lg">
                <span className="mt-0.5 shrink-0 font-mono text-sm text-danger/80" aria-hidden>
                  ×
                </span>
                <span>{item}</span>
              </li>
            </FadeIn>
          ))}
        </ul>

        <FadeIn delay={0.2}>
          <div className="rounded-3xl border border-border bg-gradient-to-br from-surface via-surface to-surface-2 p-8 sm:p-10">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">{t('landing.thenHilm')}</p>
            <p className="mt-4 text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
              {t('landing.thenHilmTitle')}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted sm:text-base">
              {t('landing.thenHilmBody')}
            </p>
          </div>
        </FadeIn>
      </div>
    </Section>
  )
}
