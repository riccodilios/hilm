import { useTranslation } from 'react-i18next'
import {
  Activity,
  BarChart3,
  Bot,
  FolderKanban,
  Network,
  Shield,
  Users,
} from 'lucide-react'
import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

const workspaceFeatures = [
  { key: 'org', icon: Network },
  { key: 'projects', icon: FolderKanban },
  { key: 'roles', icon: Shield },
  { key: 'members', icon: Users },
  { key: 'reports', icon: BarChart3 },
  { key: 'activity', icon: Activity },
  { key: 'ai', icon: Bot },
] as const

export function WorkspaceSection() {
  const { t } = useTranslation()

  return (
    <Section id="workspace">
      <FadeIn>
        <SectionHeading
          eyebrow={t('landing.workspaceEyebrow')}
          title={t('landing.workspaceTitle')}
          description={t('landing.workspaceDescription')}
        />
      </FadeIn>

      <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {workspaceFeatures.map((feature, i) => (
          <FadeIn key={feature.key} delay={Math.min(i * 0.04, 0.28)}>
            <article className="border-t border-border-subtle pt-5">
              <feature.icon className="mb-4 size-5 text-muted" strokeWidth={1.5} />
              <h3 className="text-base font-medium tracking-tight text-foreground">
                {t(`landing.workspaceFeatures.${feature.key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {t(`landing.workspaceFeatures.${feature.key}.body`)}
              </p>
            </article>
          </FadeIn>
        ))}
      </div>
    </Section>
  )
}
