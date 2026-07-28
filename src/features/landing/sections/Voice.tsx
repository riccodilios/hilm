import { useTranslation } from 'react-i18next'
import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

export function VoiceSection() {
  const { t } = useTranslation()
  const phrases = t('landing.voicePhrases', { returnObjects: true }) as string[]

  return (
    <Section className="overflow-hidden">
      <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <FadeIn>
          <SectionHeading
            eyebrow={t('landing.voiceEyebrow')}
            title={t('landing.voiceTitle')}
            description={t('landing.voiceDescription')}
          />
          <p className="text-sm text-muted">{t('landing.voiceNote')}</p>
        </FadeIn>

        <div className="space-y-3">
          {phrases.map((phrase, i) => (
            <FadeIn key={phrase} delay={i * 0.06}>
              <blockquote className="rounded-2xl border border-border-subtle bg-gradient-to-r from-surface to-transparent px-5 py-4 font-mono text-sm text-foreground/90 sm:text-base">
                <span className="text-muted-fg">“</span>
                {phrase}
                <span className="text-muted-fg">”</span>
              </blockquote>
            </FadeIn>
          ))}
        </div>
      </div>
    </Section>
  )
}
