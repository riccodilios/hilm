import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

const points = [
  {
    title: 'Encrypted credentials',
    body: 'API keys are encrypted at rest and never embedded in the client bundle.',
  },
  {
    title: 'Secure storage',
    body: 'Auth sessions persist safely. Attachments live in scoped private storage.',
  },
  {
    title: 'Private AI',
    body: 'Requests proxy through your backend with your key — Hilm does not harvest your work.',
  },
  {
    title: 'Offline support',
    body: 'Recent data stays readable on-device when you lose connectivity.',
  },
  {
    title: 'User-owned data',
    body: 'Your projects, notes, and history remain yours — exportable and under your control.',
  },
]

export function SecuritySection() {
  return (
    <Section className="bg-surface/40">
      <FadeIn>
        <SectionHeading
          eyebrow="Trust"
          title="Built for work you would not paste into a public chatbot."
          description="Security is part of the product surface — not a footnote."
        />
      </FadeIn>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {points.map((point, i) => (
          <FadeIn key={point.title} delay={i * 0.05}>
            <div className="h-full border-t border-border pt-5">
              <h3 className="text-base font-medium tracking-tight">{point.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{point.body}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </Section>
  )
}
