import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import { Bot, Check, History, LoaderCircle, Plus, Send, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { agents, defaultAgentId } from '@/features/ai/agents'
import {
  aiKeys,
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  streamChat,
  updateConversation,
} from '@/features/ai/api'
import {
  executeAiActions,
  extractActionsFromContent,
  getActionRisk,
  parseActionsForOs,
} from '@/features/ai/lib/action-executor'
import { ensureAiRegistry } from '@/features/ai/registry/bootstrap'
import { getRegisteredAction } from '@/features/ai/registry'
import type { ParsedRegistryAction } from '@/features/ai/registry/types'
import { labelKeys } from '@/features/projects/labels-api'
import { workspaceLabelKeys } from '@/features/workspace-os/labels-api'
import { activityKeys } from '@/features/activity/api'
import { homeKeys } from '@/features/home/api'
import { ideasKeys } from '@/features/ideas/api'
import { notesKeys } from '@/features/notes/api'
import { projectsKeys } from '@/features/projects/api'
import { tasksKeys } from '@/features/tasks/api'
import { workspaceKeys } from '@/features/workspace-os/api'
import { VoiceAddButton } from '@/components/VoiceAddButton'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/page'
import { Textarea } from '@/components/ui/textarea'
import { AiMarkdown } from '@/features/ai/AiMarkdown'
import { useSpeechDictation } from '@/hooks/useSpeechDictation'
import {
  mergeVoiceTranscript,
  speechLocaleFromI18n,
  type SpeechLocale,
} from '@/lib/voice-transcript'
import { cn } from '@/lib/utils'
import type { AgentId } from '@/features/ai/agents'
import type { AiMessage } from '@/features/ai/api'
import type { AiAction } from '@/types/ai-actions'

ensureAiRegistry()

type DraftMessage = AiMessage & { pending?: boolean }

function actionLabel(action: AiAction, os?: 'personal' | 'workspace') {
  const def = getRegisteredAction(String(action.type), os)
  const title = typeof action.title === 'string' ? action.title : undefined
  const name = typeof action.name === 'string' ? action.name : undefined
  const summary = typeof action.summary === 'string' ? action.summary : undefined
  return title || name || summary || def?.title || String(action.type).replace(/\./g, ' ')
}

function riskNeedsConfirm(actions: ParsedRegistryAction[], os?: 'personal' | 'workspace') {
  const risk = getActionRisk(actions, os)
  return risk === 'confirm' || risk === 'destructive'
}

export type AiPageProps = {
  mode?: 'personal' | 'workspace'
  workspaceId?: string
  workspaceRole?: import('@/features/workspace-os/lib/permissions').WorkspaceRole | null
}

export function AiPage({ mode = 'personal', workspaceId, workspaceRole }: AiPageProps = {}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('projectId') ?? undefined
  const isWorkspace = mode === 'workspace' && Boolean(workspaceId)
  const osMode = isWorkspace ? 'workspace' : 'personal'
  const [selectedId, setSelectedId] = useState<string>()
  const [agentId, setAgentId] = useState<AgentId>(defaultAgentId)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [draft, setDraft] = useState<DraftMessage | null>(null)
  const [proposedActions, setProposedActions] = useState<AiAction[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [voiceLang, setVoiceLang] = useState<SpeechLocale>(() => speechLocaleFromI18n(i18n.language))
  const [historyOpen, setHistoryOpen] = useState(false)
  const streamingRef = useRef(false)
  const voiceModeRef = useRef(false)
  const sendMessageRef = useRef<(text?: string) => Promise<void>>(async () => {})
  const dateLocale = i18n.language.startsWith('ar') ? ar : enUS

  const conversations = useQuery({
    queryKey: aiKeys.conversations(isWorkspace ? workspaceId : null),
    queryFn: () => listConversations(isWorkspace ? workspaceId : null),
  })
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
    setSelectedId(undefined)
    setProposedActions([])
    setDraft(null)
  }, [mode, workspaceId])

  useEffect(() => {
    if (!selectedId && conversations.data?.[0]) setSelectedId(conversations.data[0].id)
  }, [conversations.data, selectedId])

  useEffect(() => {
    if (selectedConversation?.agent_id) setAgentId(selectedConversation.agent_id as AgentId)
  }, [selectedConversation?.agent_id])

  useEffect(() => {
    streamingRef.current = streaming
  }, [streaming])

  useEffect(() => {
    voiceModeRef.current = voiceMode
  }, [voiceMode])

  const conversationScopeKey = aiKeys.conversations(isWorkspace ? workspaceId : null)

  const newConversation = useMutation({
    mutationFn: () =>
      createConversation({
        agentId,
        projectId,
        workspaceId: isWorkspace ? workspaceId : undefined,
      }),
    onSuccess: async (conversation) => {
      setSelectedId(conversation.id)
      setProposedActions([])
      setDraft(null)
      setHistoryOpen(false)
      await queryClient.invalidateQueries({ queryKey: conversationScopeKey })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const removeConversation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: async (_data, id) => {
      if (selectedId === id) {
        setSelectedId(undefined)
        setProposedActions([])
        setDraft(null)
      }
      await queryClient.invalidateQueries({ queryKey: conversationScopeKey })
      toast.success(t('ai.historyDeleted'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function selectConversation(id: string) {
    setSelectedId(id)
    setProposedActions([])
    setDraft(null)
    setHistoryOpen(false)
  }

  async function sendMessage(overrideText?: string) {
    const message = (overrideText ?? input).trim()
    if (!message || streamingRef.current) return

    let conversationId = selectedId
    if (!conversationId) {
      try {
        const conversation = await createConversation({
          title: message.slice(0, 60),
          agentId,
          projectId,
          workspaceId: isWorkspace ? workspaceId : undefined,
        })
        conversationId = conversation.id
        setSelectedId(conversation.id)
        await queryClient.invalidateQueries({ queryKey: conversationScopeKey })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('ai.empty'))
        return
      }
    }

    setInput('')
    setStreaming(true)
    streamingRef.current = true
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
      workspaceId: isWorkspace ? workspaceId : undefined,
      locale: i18n.language.startsWith('ar') ? 'ar' : 'en',
    })) {
      if (event.type === 'token') {
        content += event.token
        setDraft({ ...pending, content })
      } else if (event.type === 'actions') {
        const incoming = event.actions ?? []
        if (!incoming.length) continue
        const parsed = parseActionsForOs(incoming, {
          workspaceId: isWorkspace ? workspaceId : undefined,
          role: workspaceRole ?? undefined,
        })
        setProposedActions(parsed.length ? parsed : (incoming as AiAction[]))
      } else if (event.type === 'done') {
        const incoming = event.actions ?? []
        if (incoming.length) {
          const parsed = parseActionsForOs(incoming, {
            workspaceId: isWorkspace ? workspaceId : undefined,
            role: workspaceRole ?? undefined,
          })
          setProposedActions(parsed.length ? parsed : (incoming as AiAction[]))
        }
      } else if (event.type === 'error') {
        toast.error(event.error)
      }
    }

    setDraft(null)
    setStreaming(false)
    streamingRef.current = false
    const fromContent = extractActionsFromContent(content, {
      workspaceId: isWorkspace ? workspaceId : undefined,
      role: workspaceRole ?? undefined,
    })
    if (fromContent.length) setProposedActions(fromContent)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: aiKeys.messages(conversationId) }),
      queryClient.invalidateQueries({ queryKey: conversationScopeKey }),
    ])
  }

  sendMessageRef.current = sendMessage

  useEffect(() => {
    if (voiceMode) return
    setVoiceLang(speechLocaleFromI18n(i18n.language))
  }, [i18n.language, voiceMode])

  const dictation = useSpeechDictation({
    lang: voiceLang,
    keepAlive: voiceMode && !streaming,
    onFinal: (transcript, meta) => {
      if (streamingRef.current) return
      setInput((prev) =>
        mergeVoiceTranscript(prev, transcript, {
          lang: voiceLang,
          gapMs: meta.gapMs,
          confidence: meta.confidence,
        }),
      )
    },
    onError: (code) => {
      setVoiceMode(false)
      if (code === 'unsupported') toast.error(t('ai.voiceUnsupported'))
      else if (code === 'not-allowed') toast.error(t('ai.voiceDenied'))
      else toast.error(t('ai.voiceFailed'))
    },
  })

  useEffect(() => {
    if (streaming && dictation.listening) dictation.stop()
  }, [streaming, dictation.listening, dictation.stop])

  useEffect(() => {
    if (!streaming && voiceMode && !dictation.listening) dictation.start()
  }, [streaming, voiceMode, dictation.listening, dictation.start])

  function toggleVoiceMode() {
    if (dictation.listening || voiceMode) {
      setVoiceMode(false)
      dictation.stop()
      return
    }
    setVoiceMode(true)
    dictation.start()
  }

  async function runActions() {
    if (!proposedActions.length) return
    try {
      const results = await executeAiActions(proposedActions, {
        workspaceId: isWorkspace ? workspaceId : undefined,
        role: workspaceRole ?? undefined,
        sequential: true,
      })
      const succeeded = results.filter((result) => result.success)
      const failed = results.filter((result) => !result.success)
      if (succeeded.length) {
        toast.success(
          succeeded.length === 1
            ? t('ai.appliedOne')
            : t('ai.appliedMany', { count: succeeded.length }),
        )
      }
      if (failed.length) {
        const detail = failed
          .slice(0, 2)
          .map((result) => result.error || result.action.type)
          .join(' · ')
        toast.error(
          failed.length === 1
            ? t('ai.failedOne', { detail })
            : t('ai.failedMany', { count: failed.length, detail }),
        )
      }
      if (succeeded.length) setProposedActions(failed.map((result) => result.action))
      if (isWorkspace && workspaceId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: workspaceKeys.activity(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: workspaceLabelKeys.all(workspaceId) }),
        ])
      } else {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: tasksKeys.all }),
          queryClient.invalidateQueries({ queryKey: projectsKeys.all }),
          queryClient.invalidateQueries({ queryKey: homeKeys.all }),
          queryClient.invalidateQueries({ queryKey: activityKeys.all }),
          queryClient.invalidateQueries({ queryKey: ideasKeys.all }),
          queryClient.invalidateQueries({ queryKey: notesKeys.all }),
          queryClient.invalidateQueries({ queryKey: labelKeys.all }),
        ])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('ai.applyFailed'))
    } finally {
      setConfirmOpen(false)
    }
  }

  async function executeActions() {
    if (!proposedActions.length) return
    if (riskNeedsConfirm(proposedActions, osMode)) {
      setConfirmOpen(true)
      return
    }
    await runActions()
  }

  const displayedMessages: DraftMessage[] = [...(messages.data ?? []), ...(draft ? [draft] : [])]
  const chatTitle = selectedConversation?.title || t('ai.newChat')

  return (
    <div>
      <PageHeader
        title={isWorkspace ? t('ai.workspaceTitle') : t('ai.title')}
        description={isWorkspace ? t('ai.workspaceEmpty') : t('ai.empty')}
        actions={
          <>
            <Button
              variant="secondary"
              size="icon"
              aria-label={t('ai.history')}
              title={t('ai.history')}
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-4" />
            </Button>
            <Button variant="secondary" onClick={() => newConversation.mutate()} disabled={newConversation.isPending}>
              <Plus className="size-4" /> {t('ai.newChat')}
            </Button>
          </>
        }
      />

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('ai.history')}</DialogTitle>
            <DialogDescription>{t('ai.historyDesc')}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {conversations.data?.length
                ? t('ai.historyCount', { count: conversations.data.length })
                : t('ai.historyEmpty')}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => newConversation.mutate()}
              disabled={newConversation.isPending}
            >
              <Plus className="size-3.5" /> {t('ai.newChat')}
            </Button>
          </div>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto pe-1">
            {conversations.isLoading ? (
              <div className="space-y-2 py-2">
                <div className="h-14 animate-pulse rounded-xl bg-surface-2" />
                <div className="h-14 animate-pulse rounded-xl bg-surface-2" />
                <div className="h-14 animate-pulse rounded-xl bg-surface-2" />
              </div>
            ) : !conversations.data?.length ? (
              <p className="py-8 text-center text-sm text-muted">{t('ai.historyEmpty')}</p>
            ) : (
              conversations.data.map((conversation) => {
                const agentName = t(`agents.${conversation.agent_id}.name`, {
                  defaultValue: agents.find((agent) => agent.id === conversation.agent_id)?.name ?? 'AI',
                })
                const relative = formatDistanceToNow(new Date(conversation.updated_at), {
                  addSuffix: true,
                  locale: dateLocale,
                })
                const active = conversation.id === selectedId
                return (
                  <div
                    key={conversation.id}
                    className={cn(
                      'group flex items-stretch gap-1 rounded-xl border transition-colors',
                      active
                        ? 'border-accent/40 bg-accent/10'
                        : 'border-transparent hover:border-border-subtle hover:bg-surface-2/70',
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 px-3 py-2.5 text-start"
                      onClick={() => selectConversation(conversation.id)}
                    >
                      <span className="block truncate text-sm font-medium text-foreground">{conversation.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {agentName} · {relative}
                      </span>
                    </button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="me-1 mt-1 size-8 shrink-0 text-muted opacity-70 hover:text-foreground group-hover:opacity-100"
                      aria-label={t('ai.historyDelete')}
                      title={t('ai.historyDelete')}
                      disabled={removeConversation.isPending}
                      onClick={(event) => {
                        event.stopPropagation()
                        removeConversation.mutate(conversation.id)
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Card className="flex min-h-[calc(100dvh-15rem)] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{chatTitle}</p>
              <select
                value={agentId}
                onChange={(event) => {
                  const nextAgentId = event.target.value as AgentId
                  setAgentId(nextAgentId)
                  if (selectedId) void updateConversation(selectedId, { agent_id: nextAgentId })
                }}
                className="max-w-full bg-transparent text-xs text-muted outline-none"
                aria-label={t('ai.agents')}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {t(`agents.${agent.id}.name`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t('ai.history')}
            title={t('ai.history')}
            onClick={() => setHistoryOpen(true)}
          >
            <History className="size-4" />
          </Button>
        </div>

        <CardContent className="flex flex-1 flex-col p-0">
          <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
            {!displayedMessages.length ? (
              <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
                <Bot className="mb-4 size-10 text-muted" />
                <h2 className="font-medium">{isWorkspace ? t('ai.workspaceTitle') : t('ai.title')}</h2>
                <p className="mt-2 text-sm text-muted">
                  {isWorkspace ? t('ai.workspaceEmpty') : t('ai.empty')}
                </p>
              </div>
            ) : (
              displayedMessages.map((message) => (
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
              ))
            )}
          </div>

          {proposedActions.length ? (
            <div className="border-t border-border-subtle bg-surface/50 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{t('ai.actions')}</p>
                <Button size="sm" onClick={() => void executeActions()}>
                  <Check className="size-4" /> {t('ai.apply')}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {proposedActions.map((action, index) => (
                  <span
                    key={`${action.type}-${index}`}
                    className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-muted"
                  >
                    {actionLabel(action, osMode)}
                    {getRegisteredAction(String(action.type), osMode)?.risk !== 'safe' ? (
                      <span className="ms-1 text-[10px] uppercase text-warning">
                        {getRegisteredAction(String(action.type), osMode)?.risk}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Confirm actions</DialogTitle>
                <DialogDescription>
                  These actions include confirm or destructive steps. Review before applying.
                </DialogDescription>
              </DialogHeader>
              <ul className="max-h-48 space-y-2 overflow-auto text-sm">
                {proposedActions.map((action, index) => (
                  <li key={`${action.type}-confirm-${index}`} className="rounded-lg bg-surface-2 px-3 py-2">
                    <span className="font-medium">{actionLabel(action, osMode)}</span>
                    <span className="ms-2 text-xs text-muted">
                      {getRegisteredAction(String(action.type), osMode)?.risk}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void runActions()}>Confirm & apply</Button>
              </div>
            </DialogContent>
          </Dialog>

          <form
            className="border-t border-border-subtle p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void sendMessage()
            }}
          >
            {voiceMode ? (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="min-w-0 flex-1 text-xs text-muted">
                  {dictation.listening
                    ? dictation.interim
                      ? t('ai.voiceHearing', { text: dictation.interim })
                      : t('ai.voiceListening')
                    : streaming
                      ? t('ai.voiceWaiting')
                      : t('ai.voiceHint')}
                </p>
                <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border-subtle bg-surface/60 p-0.5">
                  <button
                    type="button"
                    className={cn(
                      'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                      voiceLang === 'en-US'
                        ? 'bg-accent text-background'
                        : 'text-muted hover:text-foreground',
                    )}
                    onClick={() => setVoiceLang('en-US')}
                    aria-pressed={voiceLang === 'en-US'}
                  >
                    {t('ai.voiceLangEn')}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                      voiceLang === 'ar-SA'
                        ? 'bg-accent text-background'
                        : 'text-muted hover:text-foreground',
                    )}
                    onClick={() => setVoiceLang('ar-SA')}
                    aria-pressed={voiceLang === 'ar-SA'}
                  >
                    {t('ai.voiceLangAr')}
                  </button>
                </div>
              </div>
            ) : null}
            <div
              className={cn(
                'flex items-end gap-2 rounded-xl border bg-surface-2/50 p-2 focus-within:border-accent/50',
                voiceMode ? 'border-accent/40' : 'border-border',
              )}
            >
              <VoiceAddButton
                iconOnly
                listening={voiceMode}
                supported={dictation.supported}
                onToggle={toggleVoiceMode}
                labelKey="ai.voiceMode"
                listeningKey="ai.voiceListening"
                stopKey="ai.voiceStop"
                unsupportedKey="ai.voiceUnsupported"
                className="shrink-0"
              />
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendMessage()
                    }
                  }}
                  placeholder={voiceMode ? t('ai.voicePlaceholder') : t('ai.placeholder')}
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
  )
}
