import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

const actions = [
  'Complete tasks',
  'Create tasks',
  'Update project status',
  'Generate documentation',
  'Create meeting summaries',
  'Generate release notes',
  'Track progress',
  'Find blockers',
  'Suggest priorities',
  'Maintain project history',
]

export function AutomationSection() {
  return (
    <Section>
      <FadeIn>
        <SectionHeading
          eyebrow="Automation"
          title="Chat that executes — not just answers."
          description="Hilm returns structured actions. Your projects, tasks, docs, and activity update automatically."
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
