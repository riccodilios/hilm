import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { listTasks, tasksKeys } from '@/features/tasks/api'
import { listNotes, notesKeys } from '@/features/notes/api'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { Input } from '@/components/ui/input'
import { ProjectBadge } from '@/components/ProjectBadge'
import { supabase } from '@/lib/supabase/client'
import type { Tables } from '@/types/database'

async function searchIdeas(q: string) {
  if (!q) return [] as Tables<'ideas'>[]
  const { data, error } = await supabase
    .from('ideas')
    .select('*')
    .ilike('title', `%${q}%`)
    .limit(20)
  if (error) throw error
  return data as Tables<'ideas'>[]
}

async function searchConversations(q: string) {
  if (!q) return [] as Tables<'ai_conversations'>[]
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('*')
    .ilike('title', `%${q}%`)
    .limit(20)
  if (error) throw error
  return data as Tables<'ai_conversations'>[]
}

export function SearchPage() {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  const { data: projects = [], isLoading: lp } = useQuery({
    queryKey: projectsKeys.list(),
    queryFn: listProjects,
  })
  const { data: tasks = [], isLoading: lt } = useQuery({
    queryKey: tasksKeys.list('search'),
    queryFn: () => listTasks(),
  })
  const { data: notes = [], isLoading: ln } = useQuery({
    queryKey: notesKeys.list(),
    queryFn: () => listNotes(),
  })
  const { data: ideas = [] } = useQuery({
    queryKey: ['search', 'ideas', query],
    queryFn: () => searchIdeas(query),
    enabled: query.length > 1,
  })
  const { data: conversations = [] } = useQuery({
    queryKey: ['search', 'conversations', query],
    queryFn: () => searchConversations(query),
    enabled: query.length > 1,
  })

  const results = useMemo(() => {
    if (!query) {
      return { projects: [], tasks: [], notes: [], ideas: [], conversations: [] }
    }
    return {
      projects: projects.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          (p.description ?? '').toLowerCase().includes(query),
      ),
      tasks: tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          (t.description ?? '').toLowerCase().includes(query),
      ),
      notes: notes.filter(
        (n) =>
          n.title.toLowerCase().includes(query) || n.body.toLowerCase().includes(query),
      ),
      ideas,
      conversations,
    }
  }, [query, projects, tasks, notes, ideas, conversations])

  const loading = lp || lt || ln

  return (
    <div>
      <PageHeader title={t('search.title')} description={t('search.description')} />
      <Input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('search.placeholder')}
        className="mb-6 h-12 text-base"
      />

      {loading ? <Skeleton className="h-40 w-full" /> : null}

      {!query ? (
        <p className="text-sm text-muted">{t('search.hint')}</p>
      ) : (
        <div className="space-y-8">
          <ResultSection title={t('search.projects')} empty={results.projects.length === 0} emptyLabel={t('search.noMatches')}>
            {results.projects.map((p) => (
              <Link key={p.id} to={`/app/projects/${p.id}`} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                {p.name}
              </Link>
            ))}
          </ResultSection>
          <ResultSection title={t('search.tasks')} empty={results.tasks.length === 0} emptyLabel={t('search.noMatches')}>
            {results.tasks.map((t) => (
              <Link key={t.id} to={`/app/tasks/${t.id}`} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                <p>{t.title}</p>
                {t.projects ? <ProjectBadge {...t.projects} className="mt-1" /> : null}
              </Link>
            ))}
          </ResultSection>
          <ResultSection title={t('search.notes')} empty={results.notes.length === 0} emptyLabel={t('search.noMatches')}>
            {results.notes.map((n) => (
              <Link key={n.id} to={`/app/notes/${n.id}`} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                {n.title}
              </Link>
            ))}
          </ResultSection>
          <ResultSection title={t('search.ideas')} empty={results.ideas.length === 0} emptyLabel={t('search.noMatches')}>
            {results.ideas.map((i) => (
              <div key={i.id} className="rounded-lg px-3 py-2 text-sm">
                {i.title}
              </div>
            ))}
          </ResultSection>
          <ResultSection title={t('search.conversations')} empty={results.conversations.length === 0} emptyLabel={t('search.noMatches')}>
            {results.conversations.map((c) => (
              <Link key={c.id} to={`/app/ai?c=${c.id}`} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                {c.title}
              </Link>
            ))}
          </ResultSection>
        </div>
      )}
    </div>
  )
}

function ResultSection({
  title,
  empty,
  emptyLabel,
  children,
}: {
  title: string
  empty: boolean
  emptyLabel: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">{title}</h2>
      {empty ? <p className="text-sm text-muted">{emptyLabel}</p> : <div className="space-y-1">{children}</div>}
    </section>
  )
}
