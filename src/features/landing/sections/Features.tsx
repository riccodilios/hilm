import {
  Brain,
  FolderKanban,
  CheckSquare,
  NotebookPen,
  FileText,
  Lightbulb,
  Map,
  Sparkles,
  Mic,
  Search,
  Command,
  WifiOff,
  Smartphone,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

const features = [
  { key: 'chief', icon: Brain },
  { key: 'projects', icon: FolderKanban },
  { key: 'tasks', icon: CheckSquare },
  { key: 'logs', icon: NotebookPen },
  { key: 'docs', icon: FileText },
  { key: 'ideas', icon: Lightbulb },
  { key: 'roadmaps', icon: Map },
  { key: 'automation', icon: Sparkles },
  { key: 'voice', icon: Mic },
  { key: 'search', icon: Search },
  { key: 'palette', icon: Command },
  { key: 'offline', icon: WifiOff },
  { key: 'pwa', icon: Smartphone },
]

export function FeaturesSection() {
  const { t } = useTranslation()

  return (
    <Section className="bg-surface/40">
      <FadeIn>
        <SectionHeading
          eyebrow={t('landing.featuresEyebrow')}
          title={t('landing.featuresTitle')}
          description={t('landing.featuresDescription')}
        />
      </FadeIn>

      <div className="grid gap-px overflow-hidden rounded-3xl border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, i) => (
          <FadeIn key={feature.key} delay={Math.min(i * 0.03, 0.3)} className="bg-background">
            <article className="flex h-full flex-col gap-4 p-6 transition-colors hover:bg-surface/80 sm:p-7">
              <feature.icon className="size-5 text-muted" strokeWidth={1.5} />
              <div>
                <h3 className="text-base font-medium tracking-tight text-foreground">
                  {t(`landing.features.${feature.key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {t(`landing.features.${feature.key}.body`)}
                </p>
              </div>
            </article>
          </FadeIn>
        ))}
      </div>
    </Section>
  )
}
