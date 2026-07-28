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
import { FadeIn, Section, SectionHeading } from '@/features/landing/primitives'

const features = [
  {
    icon: Brain,
    title: 'AI Chief of Staff',
    body: 'An agent that understands every project and proposes the next move.',
  },
  {
    icon: FolderKanban,
    title: 'Projects',
    body: 'Health, progress, and context for everything you build.',
  },
  {
    icon: CheckSquare,
    title: 'Tasks',
    body: 'Statuses, estimates, dependencies, and kanban that stay current.',
  },
  {
    icon: NotebookPen,
    title: 'Daily Logs',
    body: 'What you shipped, what blocked you, and what comes next.',
  },
  {
    icon: FileText,
    title: 'Documentation',
    body: 'Living docs that stay aligned with decisions and releases.',
  },
  {
    icon: Lightbulb,
    title: 'Ideas',
    body: 'Capture sparks, score impact, convert into real work.',
  },
  {
    icon: Map,
    title: 'Roadmaps',
    body: 'Now, next, later, future — without losing the thread.',
  },
  {
    icon: Sparkles,
    title: 'AI Automation',
    body: 'Structured actions that update your system, not just chat.',
  },
  {
    icon: Mic,
    title: 'Voice Commands',
    body: 'Speak naturally. Hilm routes intent into actions.',
  },
  {
    icon: Search,
    title: 'Smart Search',
    body: 'Find tasks, notes, ideas, and conversations instantly.',
  },
  {
    icon: Command,
    title: 'Command Palette',
    body: 'Raycast-speed shortcuts from anywhere in the app.',
  },
  {
    icon: WifiOff,
    title: 'Offline Support',
    body: 'Read your work when the network drops.',
  },
  {
    icon: Smartphone,
    title: 'Progressive Web App',
    body: 'Install Hilm. Launch it like a native product.',
  },
]

export function FeaturesSection() {
  return (
    <Section className="bg-surface/40">
      <FadeIn>
        <SectionHeading
          eyebrow="Capabilities"
          title="Everything your personal OS needs — with AI in the loop."
          description="Not a pile of features. A coherent system where each surface feeds the next."
        />
      </FadeIn>

      <div className="grid gap-px overflow-hidden rounded-3xl border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, i) => (
          <FadeIn key={feature.title} delay={Math.min(i * 0.03, 0.3)} className="bg-background">
            <article className="flex h-full flex-col gap-4 p-6 transition-colors hover:bg-surface/80 sm:p-7">
              <feature.icon className="size-5 text-muted" strokeWidth={1.5} />
              <div>
                <h3 className="text-base font-medium tracking-tight text-foreground">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{feature.body}</p>
              </div>
            </article>
          </FadeIn>
        ))}
      </div>
    </Section>
  )
}
