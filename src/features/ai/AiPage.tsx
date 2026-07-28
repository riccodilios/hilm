import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Bot, Check, LoaderCircle, Plus, Send, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { agents, defaultAgentId } from '@/features/ai/agents'
import { aiKeys, createConversation, listConversations, listMessages, streamChat, updateConversation } from '@/features/ai/api'
import { executeAiActions } from '@/features/ai/lib/action-executor'
import { activityKeys } from '@/features/activity/api'
import { homeKeys } from '@/features/home/api'
import { projectsKeys } from '@/features/projects/api'
import { tasksKeys } from '@/features/tasks/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page'
import { Textarea } from '@/components/ui/textarea'
import { AiMarkdown } from '@/features/ai/AiMarkdown'
import { cn } from '@/lib/utils'
import type { AgentId } from '@/features/ai/agents'
import type { AiMessage } from '@/features/ai/api'
import type { AiAction } from '@/types/ai-actions'

type DraftMessage = AiMessage & { pending?: boolean }

function actionLabel(action: AiAction) {
  switch (action.type) {
    case 'task.create':
    case 'note.create':
    case 'roadmap.create':
    case 'idea.create':
      return action.title
    case 'project.create':
      return action.name
    case 'activity.note':
      return action.summary
    default:
      return action.type.replace('.', ' ')
  }
}

export function AiPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('projectId') ?? undefined
  const [selectedId, setSelectedId] = useState<string>()
  const [agentId, setAgentId] = useState<AgentId>(defaultAgentId)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [draft, setDraft] = useState<DraftMessage | null>(null)
  const [proposedActions, setProposedActions] = useState<AiAction[]>([])

  const conversations = useQuery({ queryKey: aiKeys.conversations(), queryFn: listConversations })
  const selectedConversation = useMemo(
    () => conversations.data?.find((conversation) => conversation.id === selectedId),
    [conversations.data, selectedId],
  )
  const messages = useQuery({
    queryKey: aiKeys.messages(selectedId ?? 'new'),
    queryFn: () => listMessages(selectedId!),
    enabled: Boolean(selectedId),
  })

  useEffect(() => {
    if (!selectedId && conversations.data?.[0]) setSelectedId(conversations.data[0].id)
  }, [conversations.data, selectedId])

  useEffect(() => {
    if (selectedConversation?.agent_id) setAgentId(selectedConversation.agent_id as AgentId)
  }, [selectedConversation?.agent_id])

  const newConversation = useMutation({
    mutationFn: () => createConversation({ agentId, projectId }),
    onSuccess: async (conversation) => {
      setSelectedId(conversation.id)
      setProposedActions([])
      await queryClient.invalidateQueries({ queryKey: aiKeys.conversations() })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  async function sendMessage() {
    const message = input.trim()
    if (!message || streaming) return

    let conversationId = selectedId
    if (!conversationId) {
      try {
        const conversation = await createConversation({ title: message.slice(0, 60), agentId, projectId })
        conversationId = conversation.id
        setSelectedId(conversation.id)
        await queryClient.invalidateQueries({ queryKey: aiKeys.conversations() })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('ai.empty'))
        return
      }
    }

    setInput('')
    setStreaming(true)
    setProposedActions([])
    const pending: DraftMessage = {
      id: 'pending',
      conversation_id: conversationId,
      user_id: '',
      role: 'assistant',
      content: '',
      actions: [],
      model: null,
      created_at: new Date().toISOString(),
      pending: true,
    }
    setDraft(pending)
    let content = ''

    for await (const event of streamChat({
      conversationId,
      message,
      agentId,
      projectId,
      locale: i18n.language.startsWith('ar') ? 'ar' : 'en',
    })) {
      if (event.type === 'token') {
        content += event.token
        setDraft({ ...pending, content })
      } else if (event.type === 'actions') {
        setProposedActions(event.actions)
      } else if (event.type === 'done') {
        if (event.actions) setProposedActions(event.actions)
      } else if (event.type === 'error') {
        toast.error(event.error)
      }
    }

    setDraft(null)
    setStreaming(false)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: aiKeys.messages(conversationId) }),
      queryClient.invalidateQueries({ queryKey: aiKeys.conversations() }),
    ])
  }

  async function executeActions() {
    if (!proposedActions.length) return
    const results = await executeAiActions(proposedActions)
    const succeeded = results.filter((result) => result.success).length
    const failed = results.length - succeeded
    if (succeeded) toast.success(`${succeeded} action${succeeded === 1 ? '' : 's'} completed`)
    if (failed) toast.error(`${failed} action${failed === 1 ? '' : 's'} failed`)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tasksKeys.all }),
      queryClient.invalidateQueries({ queryKey: projectsKeys.all }),
      queryClient.invalidateQueries({ queryKey: homeKeys.all }),
      queryClient.invalidateQueries({ queryKey: activityKeys.all }),
    ])
  }

  const displayedMessages: DraftMessage[] = [...(messages.data ?? []), ...(draft ? [draft] : [])]

  return (
    <div>
      <PageHeader
        title={t('ai.title')}
        description={t('ai.empty')}
        actions={
          <Button variant="secondary" onClick={() => newConversation.mutate()} disabled={newConversation.isPending}>
            <Plus className="size-4" /> {t('ai.newChat')}
          </Button>
        }
      />

      <div className="grid min-h-[calc(100dvh-15rem)] gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="hidden rounded-2xl border border-border-subtle bg-surface/60 p-3 lg:block">
          <p className="mb-3 px-2 text-xs font-medium uppercase tracking-[0.16em] text-muted">{t('search.conversations')}</p>
          <div className="space-y-1">
            {conversations.data?.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => {
                  setSelectedId(conversation.id)
                  setProposedActions([])
                }}
                className={cn(
                  'w-full rounded-xl px-3 py-2 text-left text-sm transition-colors',
                  conversation.id === selectedId ? 'bg-surface-2 text-foreground' : 'text-muted hover:bg-surface-2/60 hover:text-foreground',
                )}
              >
                <span className="block truncate">{conversation.title}</span>
                <span className="mt-0.5 block truncate text-xs opacity-70">
                  {agents.find((agent) => agent.id === conversation.agent_id)?.name ?? 'AI'}
                </span>
              </button>
            ))}
            {!conversations.data?.length ? <p className="px-2 text-sm text-muted">{t('ai.empty')}</p> : null}
          </div>
        </aside>

        <Card className="flex min-h-[560px] flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Sparkles className="size-4" />
              </span>
              <select
                value={agentId}
                onChange={(event) => {
                  const nextAgentId = event.target.value as AgentId
                  setAgentId(nextAgentId)
                  if (selectedId) void updateConversation(selectedId, { agent_id: nextAgentId })
                }}
                className="bg-transparent text-sm font-medium outline-none"
                aria-label={t('ai.agents')}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {t(`agents.${agent.id}.name`)}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted">{agents.find((agent) => agent.id === agentId)?.description}</p>
          </div>

          <CardContent className="flex flex-1 flex-col p-0">
            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              {!displayedMessages.length ? (
                <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
                  <Bot className="mb-4 size-10 text-muted" />
                  <h2 className="font-medium">{t('ai.title')}</h2>
                  <p className="mt-2 text-sm text-muted">{t('ai.empty')}</p>
                </div>
              ) : displayedMessages.map((message) => (
                <div
                  key={message.id}
                  className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[min(88%,42rem)] rounded-2xl px-4 py-3',
                      message.role === 'user'
                        ? 'bg-accent text-accent-fg'
                        : 'border border-border-subtle bg-surface-2 text-foreground',
                    )}
                  >
                    {message.content ? (
                      <AiMarkdown content={message.content} inverse={message.role === 'user'} />
                    ) : message.pending ? (
                      <LoaderCircle className="size-4 animate-spin opacity-70" />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {proposedActions.length ? (
              <div className="border-t border-border-subtle bg-surface/50 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{t('ai.actions')}</p>
                  <Button size="sm" onClick={() => void executeActions()}><Check className="size-4" /> {t('ai.apply')}</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {proposedActions.map((action, index) => (
                    <span key={`${action.type}-${index}`} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-muted">
                      {actionLabel(action)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <form className="border-t border-border-subtle p-3" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}>
              <div className="flex items-end gap-2 rounded-xl border border-border bg-surface-2/50 p-2 focus-within:border-accent/50">
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendMessage()
                    }
                  }}
                  placeholder={t('ai.placeholder')}
                  className="min-h-10 resize-none border-0 bg-transparent px-2 py-1 shadow-none focus-visible:ring-0"
                  rows={1}
                />
                <Button type="submit" size="icon" disabled={!input.trim() || streaming} aria-label={t('ai.send')}>
                  {streaming ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
