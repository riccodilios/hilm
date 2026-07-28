import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

const phrases = [
  'Finished authentication.',
  'Create a task for payment testing.',
  'Remind me tomorrow.',
  "Summarize today's work.",
]

export function VoiceSection() {
  return (
    <Section className="overflow-hidden">
      <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <FadeIn>
          <SectionHeading
            eyebrow="Voice"
            title="Speak the way you already think."
            description="Say what happened. Hilm finds the task, marks it done, logs activity, and suggests what to do next."
          />
          <p className="text-sm text-muted">Everything updates automatically — no form filling required.</p>
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
