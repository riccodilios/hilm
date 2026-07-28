import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

const failures = [
  'You update everything manually.',
  'AI forgets context between chats.',
  'Projects become scattered across tools.',
  'Documentation gets outdated the moment you ship.',
  'Ideas disappear into notes you never reopen.',
]

export function ProblemSection() {
  return (
    <Section>
      <FadeIn>
        <SectionHeading
          eyebrow="The problem"
          title="Project tools were built for tracking work — not running it."
          description="Spreadsheets of status, disconnected AI chats, and five apps fighting to be the source of truth. You become the integration layer."
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
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Then Hilm</p>
            <p className="mt-4 text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
              One operating system that remembers your work and acts on it.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted sm:text-base">
              Hilm sits above your projects as an AI Chief of Staff — keeping context, executing
              changes, and keeping every surface in sync.
            </p>
          </div>
        </FadeIn>
      </div>
    </Section>
  )
}
