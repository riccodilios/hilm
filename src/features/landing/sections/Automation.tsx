import { useTranslation } from 'react-i18next'
import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

export function AutomationSection() {
  const { t } = useTranslation()
  const actions = t('landing.automationActions', { returnObjects: true }) as string[]

  return (
    <Section>
      <FadeIn>
        <SectionHeading
          eyebrow={t('landing.automationEyebrow')}
          title={t('landing.automationTitle')}
          description={t('landing.automationDescription')}
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <div className="rounded-3xl border border-border bg-surface/60 p-6 sm:p-10">
          <div className="grid gap-3 sm:grid-cols-2">
            {actions.map((action) => (
              <div
                key={action}
                className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-sm text-foreground/90 transition-colors hover:border-border-subtle hover:bg-surface-2/60 sm:text-base"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-info/70" />
                {action}
              </div>
            ))}
          </div>
        </div>
      </FadeIn>
    </Section>
  )
}
