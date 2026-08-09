import {
  AlertCircle,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  FolderKanban,
  Gauge,
  Scale,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type SuggestedPrompt = {
  id: string
  labelKey: string
  defaultLabel: string
  promptKey: string
  defaultPrompt: string
  icon: LucideIcon
}

const PERSONAL_PROMPTS: SuggestedPrompt[] = [
  {
    id: 'plan-day',
    labelKey: 'ai.suggestions.planDay',
    defaultLabel: 'Plan my day',
    promptKey: 'ai.suggestions.planDayPrompt',
    defaultPrompt: 'Plan my day based on what’s due, overdue, and highest priority.',
    icon: CalendarDays,
  },
  {
    id: 'prioritize',
    labelKey: 'ai.suggestions.prioritize',
    defaultLabel: 'What should I prioritize?',
    promptKey: 'ai.suggestions.prioritizePrompt',
    defaultPrompt: 'What should I prioritize right now, and why?',
    icon: Target,
  },
  {
    id: 'organize',
    labelKey: 'ai.suggestions.organize',
    defaultLabel: 'Organize my projects',
    promptKey: 'ai.suggestions.organizePrompt',
    defaultPrompt: 'Help me organize my projects and clean up messy task lists.',
    icon: FolderKanban,
  },
  {
    id: 'schedule',
    labelKey: 'ai.suggestions.schedule',
    defaultLabel: 'Build my schedule',
    promptKey: 'ai.suggestions.schedulePrompt',
    defaultPrompt: 'Build a realistic schedule for my open work today.',
    icon: CalendarRange,
  },
  {
    id: 'overdue',
    labelKey: 'ai.suggestions.overdue',
    defaultLabel: "What's overdue?",
    promptKey: 'ai.suggestions.overduePrompt',
    defaultPrompt: 'What’s overdue, and what should I clear first?',
    icon: AlertCircle,
  },
]

const WORKSPACE_PROMPTS: SuggestedPrompt[] = [
  {
    id: 'team-status',
    labelKey: 'ai.suggestions.teamStatus',
    defaultLabel: 'How is my team doing?',
    promptKey: 'ai.suggestions.teamStatusPrompt',
    defaultPrompt: 'How is my team doing this week? Summarize load and delivery risk.',
    icon: Users,
  },
  {
    id: 'overloaded',
    labelKey: 'ai.suggestions.overloaded',
    defaultLabel: 'Who is overloaded?',
    promptKey: 'ai.suggestions.overloadedPrompt',
    defaultPrompt: 'Who is overloaded right now, and how should we rebalance?',
    icon: Gauge,
  },
  {
    id: 'risks',
    labelKey: 'ai.suggestions.projectRisks',
    defaultLabel: 'Show me project risks',
    promptKey: 'ai.suggestions.projectRisksPrompt',
    defaultPrompt: 'Show me project risks, blockers, and anything that looks stalled.',
    icon: AlertCircle,
  },
  {
    id: 'balance',
    labelKey: 'ai.suggestions.balanceWorkload',
    defaultLabel: "Balance my team's workload",
    promptKey: 'ai.suggestions.balanceWorkloadPrompt',
    defaultPrompt: 'Balance my team’s workload and propose concrete reassignment steps.',
    icon: Scale,
  },
  {
    id: 'week-progress',
    labelKey: 'ai.suggestions.weekProgress',
    defaultLabel: "Summarize this week's progress",
    promptKey: 'ai.suggestions.weekProgressPrompt',
    defaultPrompt: 'Summarize this week’s progress across projects and completed work.',
    icon: ClipboardList,
  },
]

export function suggestedPromptsForOs(os: 'personal' | 'workspace') {
  return os === 'workspace' ? WORKSPACE_PROMPTS : PERSONAL_PROMPTS
}

export function AiSuggestedPrompts({
  os,
  onSelect,
  disabled,
}: {
  os: 'personal' | 'workspace'
  onSelect: (prompt: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const prompts = suggestedPromptsForOs(os)

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center py-10 text-center sm:py-16">
      <span className="mb-4 flex size-11 items-center justify-center rounded-2xl border border-border-subtle bg-surface-2/80 text-muted shadow-sm">
        <Sparkles className="size-5" />
      </span>
      <h2 className="font-medium tracking-tight">
        {os === 'workspace' ? t('ai.workspaceTitle') : t('ai.title')}
      </h2>
      <p className="mt-2 max-w-sm text-sm text-muted">
        {os === 'workspace' ? t('ai.workspaceEmpty') : t('ai.empty')}
      </p>
      <div className="mt-8 grid w-full gap-2 sm:grid-cols-1">
        {prompts.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() =>
                onSelect(t(item.promptKey, { defaultValue: item.defaultPrompt }))
              }
              className={cn(
                'group flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface/40 px-3.5 py-3 text-start text-sm transition-all duration-200',
                'hover:-translate-y-0.5 hover:border-border hover:bg-surface hover:shadow-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-surface-2 text-muted transition-colors group-hover:text-foreground">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">
                {t(item.labelKey, { defaultValue: item.defaultLabel })}
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-60" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
