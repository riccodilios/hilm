import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { listTasks, tasksKeys } from '@/features/tasks/api'
import { listNotes, notesKeys } from '@/features/notes/api'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { Input } from '@/components/ui/input'
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
      <PageHeader title="Search" description="Find tasks, projects, notes, ideas, and conversations." />
      <Input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search everything…"
        className="mb-6 h-12 text-base"
      />

      {loading ? <Skeleton className="h-40 w-full" /> : null}

      {!query ? (
        <p className="text-sm text-muted">Start typing to search across Hilm.</p>
      ) : (
        <div className="space-y-8">
          <ResultSection title="Projects" empty={results.projects.length === 0}>
            {results.projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                {p.name}
              </Link>
            ))}
          </ResultSection>
          <ResultSection title="Tasks" empty={results.tasks.length === 0}>
            {results.tasks.map((t) => (
              <Link key={t.id} to={`/tasks/${t.id}`} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                {t.title}
              </Link>
            ))}
          </ResultSection>
          <ResultSection title="Notes" empty={results.notes.length === 0}>
            {results.notes.map((n) => (
              <Link key={n.id} to={`/notes/${n.id}`} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                {n.title}
              </Link>
            ))}
          </ResultSection>
          <ResultSection title="Ideas" empty={results.ideas.length === 0}>
            {results.ideas.map((i) => (
              <div key={i.id} className="rounded-lg px-3 py-2 text-sm">
                {i.title}
              </div>
            ))}
          </ResultSection>
          <ResultSection title="AI conversations" empty={results.conversations.length === 0}>
            {results.conversations.map((c) => (
              <Link key={c.id} to={`/ai?c=${c.id}`} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
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
  children,
}: {
  title: string
  empty: boolean
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">{title}</h2>
      {empty ? <p className="text-sm text-muted">No matches.</p> : <div className="space-y-1">{children}</div>}
    </section>
  )
}
