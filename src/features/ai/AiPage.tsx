import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import { ArrowDown, Check, History, LoaderCircle, Plus, Send, Sparkles, Trash2 } from 'lucide-react'
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
import {
  readConversationFocus,
  writeConversationFocus,
} from '@/features/ai/lib/conversation-focus'
import { rewriteActionsForConversationFocus } from '@/features/ai/lib/rewrite-actions'
import {
  coalesceWorkspaceTaskCreates,
  expandCreateManyForDisplay,
} from '@/features/ai/lib/batch-engine'
import { ensureAiRegistry } from '@/features/ai/registry/bootstrap'
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
import {
  AiActionProgress,
  flattenProposedActionLabels,
  humanActionLabel,
  type ActionRunItem,
} from '@/features/ai/components/AiActionProgress'
import { AiSuggestedPrompts } from '@/features/ai/components/AiSuggestedPrompts'
import { AiThinkingIndicator } from '@/features/ai/components/AiThinkingIndicator'
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

type DraftMessage = AiMessage & { pending?: boolean; local?: boolean }

function riskNeedsConfirm(actions: ParsedRegistryAction[], os?: 'personal' | 'workspace') {
  const risk = getActionRisk(actions, os)
  return risk === 'confirm' || risk === 'destructive'
}

function friendlyAiError(raw: string | undefined, fallback: string) {
  if (!raw) return fallback
  const text = raw.trim()
  if (!text) return fallback
  if (/stack|exception|postgres|pgrst|zod|uuid|sql|fetch failed|networkerror/i.test(text)) {
    return fallback
  }
  if (text.length > 160) return fallback
  return text
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
  const [optimisticUser, setOptimisticUser] = useState<DraftMessage | null>(null)
  const [draft, setDraft] = useState<DraftMessage | null>(null)
  const [proposedActions, setProposedActions] = useState<AiAction[]>([])
  const [actionRun, setActionRun] = useState<ActionRunItem[]>([])
  const [actionSummary, setActionSummary] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [voiceLang, setVoiceLang] = useState<SpeechLocale>(() => speechLocaleFromI18n(i18n.language))
  const [historyOpen, setHistoryOpen] = useState(false)
  const [stickToBottom, setStickToBottom] = useState(true)
  const [showJump, setShowJump] = useState(false)
  const streamingRef = useRef(false)
  const voiceModeRef = useRef(false)
  const sendMessageRef = useRef<(text?: string) => Promise<void>>(async () => {})
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastUserMessageRef = useRef('')
  const dateLocale = i18n.language.startsWith('ar') ? ar : enUS

  function applyProposed(raw: AiAction[], conversationId?: string, userMessage?: string) {
    const focus = readConversationFocus(conversationId ?? selectedId)
    const parsed = parseActionsForOs(raw, {
      workspaceId: isWorkspace ? workspaceId : undefined,
      role: workspaceRole ?? undefined,
    })
    const base = parsed.length ? parsed : (raw as AiAction[])
    const rewritten = rewriteActionsForConversationFocus(base as never, {
      userMessage: userMessage ?? lastUserMessageRef.current,
      focus,
    }) as AiAction[]
    const next =
      isWorkspace
        ? (coalesceWorkspaceTaskCreates(rewritten as never) as AiAction[])
        : rewritten
    setProposedActions(next)
  }

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
    setOptimisticUser(null)
    setDraft(null)
    setActionRun([])
    setActionSummary(null)
    setStreamError(null)
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
      setOptimisticUser(null)
      setDraft(null)
      setActionRun([])
      setActionSummary(null)
      setStreamError(null)
      setHistoryOpen(false)
      await queryClient.invalidateQueries({ queryKey: conversationScopeKey })
    },
    onError: () =>
      toast.error(t('ai.somethingWrong', { defaultValue: 'Something went wrong' })),
  })

  const removeConversation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: async (_data, id) => {
      if (selectedId === id) {
        setSelectedId(undefined)
        setProposedActions([])
        setOptimisticUser(null)
        setDraft(null)
      }
      await queryClient.invalidateQueries({ queryKey: conversationScopeKey })
      toast.success(t('ai.historyDeleted'))
    },
    onError: () =>
      toast.error(t('ai.somethingWrong', { defaultValue: 'Something went wrong' })),
  })

  function selectConversation(id: string) {
    setSelectedId(id)
    setProposedActions([])
    setOptimisticUser(null)
    setDraft(null)
    setActionRun([])
    setActionSummary(null)
    setStreamError(null)
    setHistoryOpen(false)
    setStickToBottom(true)
  }

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    setShowJump(false)
    setStickToBottom(true)
  }, [])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distance < 80
    setStickToBottom(nearBottom)
    if (nearBottom) setShowJump(false)
  }

  function handleScrollTouchStart() {
    // First upward read of older messages — stop auto-follow immediately.
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 40) {
      setStickToBottom(false)
    }
  }

  useEffect(() => {
    if (!stickToBottom) {
      if (streaming || draft || optimisticUser) setShowJump(true)
      return
    }
    scrollToBottom(Boolean(draft?.content))
  }, [messages.data, draft, optimisticUser, streaming, stickToBottom, scrollToBottom])

  async function sendMessage(overrideText?: string) {
    const message = (overrideText ?? input).trim()
    if (!message || streamingRef.current) return

    const now = new Date().toISOString()
    const userLocal: DraftMessage = {
      id: `local-user-${Date.now()}`,
      conversation_id: selectedId ?? 'pending',
      user_id: '',
      role: 'user',
      content: message,
      actions: [],
      model: null,
      created_at: now,
      local: true,
    }
    const pending: DraftMessage = {
      id: `local-assistant-${Date.now()}`,
      conversation_id: selectedId ?? 'pending',
      user_id: '',
      role: 'assistant',
      content: '',
      actions: [],
      model: null,
      created_at: now,
      pending: true,
      local: true,
    }

    setInput('')
    setStreamError(null)
    setRetryMessage(null)
    setProposedActions([])
    setActionRun([])
    setActionSummary(null)
    setOptimisticUser(userLocal)
    setDraft(pending)
    setStreaming(true)
    streamingRef.current = true
    setStickToBottom(true)
    lastUserMessageRef.current = message

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
      } catch {
        setOptimisticUser(null)
        setDraft(null)
        setStreaming(false)
        streamingRef.current = false
        setRetryMessage(message)
        setStreamError(t('ai.couldNotSend', { defaultValue: 'I couldn’t send that message.' }))
        return
      }
    }

    let content = ''
    let hadError = false
    const focus = readConversationFocus(conversationId)

    for await (const event of streamChat({
      conversationId,
      message,
      agentId,
      projectId,
      workspaceId: isWorkspace ? workspaceId : undefined,
      locale: i18n.language.startsWith('ar') ? 'ar' : 'en',
      conversationFocus: focus,
    })) {
      if (event.type === 'token') {
        content += event.token
        setDraft({ ...pending, conversation_id: conversationId, content, pending: false })
      } else if (event.type === 'actions') {
        const incoming = event.actions ?? []
        if (!incoming.length) continue
        applyProposed(incoming, conversationId, message)
      } else if (event.type === 'actions_warning') {
        toast.message(event.warning)
      } else if (event.type === 'done') {
        const incoming = event.actions ?? []
        if (incoming.length) applyProposed(incoming, conversationId, message)
        if (event.truncated) {
          toast.message(
            t('ai.actionsTruncated', {
              defaultValue: 'Action plan may be incomplete — review before applying.',
            }),
          )
        }
      } else if (event.type === 'error') {
        hadError = true
        setRetryMessage(message)
        setStreamError(
          friendlyAiError(
            event.error,
            t('ai.couldNotComplete', { defaultValue: 'I couldn’t complete that action.' }),
          ),
        )
      }
    }

    setDraft(null)
    if (!hadError) setOptimisticUser(null)
    setStreaming(false)
    streamingRef.current = false

    if (!hadError) {
      const fromContent = extractActionsFromContent(content, {
        workspaceId: isWorkspace ? workspaceId : undefined,
        role: workspaceRole ?? undefined,
      })
      if (fromContent.length) applyProposed(fromContent as AiAction[], conversationId, message)
    } else {
      // Keep the optimistic user bubble visible after a failed reply.
      setOptimisticUser((prev) =>
        prev
          ? prev
          : {
              id: `local-user-retry-${Date.now()}`,
              conversation_id: conversationId,
              user_id: '',
              role: 'user',
              content: message,
              actions: [],
              model: null,
              created_at: now,
              local: true,
            },
      )
    }

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

  async function invalidateAfterActions() {
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
  }

  async function runActions() {
    if (!proposedActions.length || applying) return
    setApplying(true)
    setActionSummary(null)

    const initial: ActionRunItem[] = []
    for (let index = 0; index < proposedActions.length; index++) {
      const action = proposedActions[index]!
      const batchRows = expandCreateManyForDisplay(action as ParsedRegistryAction)
      if (batchRows.length) {
        for (const row of batchRows) {
          initial.push({
            key: `${index}-${row.key}`,
            label: row.label,
            status: 'pending',
          })
        }
      } else {
        initial.push({
          key: `${action.type}-${index}`,
          label: humanActionLabel(action, osMode),
          status: 'pending',
        })
      }
    }
    setActionRun(initial)

    const remaining: AiAction[] = []
    let succeeded = 0
    let failed = 0

    try {
      for (let index = 0; index < proposedActions.length; index++) {
        const action = proposedActions[index]!
        const batchRows = expandCreateManyForDisplay(action as ParsedRegistryAction)
        const isBatch = batchRows.length > 0

        if (isBatch) {
          setActionRun((prev) =>
            prev.map((item) =>
              item.key.startsWith(`${index}-`) ? { ...item, status: 'running' } : item,
            ),
          )
        } else {
          setActionRun((prev) =>
            prev.map((item) =>
              item.key === `${action.type}-${index}` ? { ...item, status: 'running' } : item,
            ),
          )
        }

        const [result] = await executeAiActions([action as ParsedRegistryAction], {
          workspaceId: isWorkspace ? workspaceId : undefined,
          role: workspaceRole ?? undefined,
          sequential: true,
          coalesceCreates: isWorkspace,
          userMessage: lastUserMessageRef.current,
          conversationFocus: readConversationFocus(selectedId),
        })

        if (result?.success || (isBatch && result?.data && typeof result.data === 'object' && Number((result.data as { succeeded?: number }).succeeded) > 0)) {
          const batchData = result?.data as
            | {
                items?: Array<{
                  index: number
                  title: string
                  ok: boolean
                  summary: string
                  taskId?: string
                  error?: string
                }>
                project_id?: string
                project_name?: string
                succeeded?: number
                failed?: number
              }
            | undefined

          if (isBatch && batchData?.items) {
            const okCount = batchData.items.filter((item) => item.ok).length
            const failCount = batchData.items.length - okCount
            succeeded += okCount
            failed += failCount
            setActionRun((prev) =>
              prev.map((item) => {
                if (!item.key.startsWith(`${index}-`)) return item
                const itemIndex = Number(item.key.split('create-many-')[1] ?? -1)
                const row = batchData.items?.find((entry) => entry.index === itemIndex)
                if (!row) return item
                return {
                  ...item,
                  status: row.ok ? 'done' : 'error',
                  label: row.ok ? row.summary || row.title : item.label,
                  error: row.ok ? undefined : row.error || row.summary,
                }
              }),
            )
            if (failCount) remaining.push(action)
            const firstOk = batchData.items.find((item) => item.ok && item.taskId)
            if (firstOk?.taskId && selectedId) {
              writeConversationFocus(selectedId, {
                lastCreatedTaskId: firstOk.taskId,
                lastModifiedTaskId: firstOk.taskId,
                lastTaskTitle: firstOk.title,
                lastReferencedWorkspaceId: isWorkspace ? workspaceId : null,
                lastReferencedProjectId: batchData.project_id,
                lastReferencedProjectName: batchData.project_name,
                lastTaskRef: firstOk.taskId,
              })
            }
          } else if (result?.success) {
            succeeded += 1
            const entityProject = result.entities?.find((entity) => entity.type === 'project')
            const entityTask = result.entities?.find((entity) => entity.type === 'task')
            const taskIdFromAction =
              typeof action.taskId === 'string' ? action.taskId : undefined
            const taskId = entityTask?.id ?? taskIdFromAction
            const titleFromAction =
              typeof action.title === 'string' ? action.title : undefined
            const titleFromData =
              result.data &&
              typeof result.data === 'object' &&
              'title' in result.data &&
              typeof (result.data as { title?: unknown }).title === 'string'
                ? (result.data as { title: string }).title
                : undefined
            const projectNameFromAction =
              typeof action.name === 'string' ? action.name : undefined
            const projectNameFromData =
              result.data &&
              typeof result.data === 'object' &&
              'project_name' in result.data &&
              typeof (result.data as { project_name?: unknown }).project_name === 'string'
                ? (result.data as { project_name: string }).project_name
                : result.data &&
                    typeof result.data === 'object' &&
                    'name' in result.data &&
                    typeof (result.data as { name?: unknown }).name === 'string'
                  ? (result.data as { name: string }).name
                  : undefined
            const projectIdFromData =
              result.data &&
              typeof result.data === 'object' &&
              'project_id' in result.data &&
              typeof (result.data as { project_id?: unknown }).project_id === 'string'
                ? (result.data as { project_id: string }).project_id
                : undefined

            if (selectedId && (entityProject || taskId)) {
              const isCreate = String(action.type) === 'task.create'
              writeConversationFocus(selectedId, {
                ...(taskId && isCreate ? { lastCreatedTaskId: taskId } : {}),
                ...(taskId ? { lastModifiedTaskId: taskId } : {}),
                lastTaskTitle: titleFromData ?? titleFromAction ?? undefined,
                lastReferencedWorkspaceId: isWorkspace ? workspaceId : null,
                lastReferencedProjectId:
                  entityProject?.id ?? projectIdFromData ?? undefined,
                lastReferencedProjectName:
                  projectNameFromData ??
                  projectNameFromAction ??
                  (typeof action.projectName === 'string' ? action.projectName : undefined),
                lastTaskRef:
                  result.data &&
                  typeof result.data === 'object' &&
                  'task_ref' in result.data &&
                  typeof (result.data as { task_ref?: unknown }).task_ref === 'string'
                    ? (result.data as { task_ref: string }).task_ref
                    : undefined,
              })
            }
            setActionRun((prev) =>
              prev.map((item) =>
                item.key === `${action.type}-${index}`
                  ? {
                      ...item,
                      status: 'done',
                      label: result.summary || item.label,
                    }
                  : item,
              ),
            )
          }
        } else {
          failed += 1
          remaining.push(action)
          if (isBatch) {
            setActionRun((prev) =>
              prev.map((item) =>
                item.key.startsWith(`${index}-`)
                  ? {
                      ...item,
                      status: 'error',
                      error: result?.error,
                    }
                  : item,
              ),
            )
          } else {
            setActionRun((prev) =>
              prev.map((item) =>
                item.key === `${action.type}-${index}`
                  ? {
                      ...item,
                      status: 'error',
                      error: result?.error,
                      label: item.label,
                    }
                  : item,
              ),
            )
          }
        }
      }

      if (succeeded && !failed) {
        setActionSummary(
          succeeded === 1
            ? t('ai.appliedOne')
            : t('ai.appliedMany', { count: succeeded }),
        )
        setProposedActions([])
      } else if (failed) {
        setProposedActions(remaining)
      }
      if (succeeded) await invalidateAfterActions()
    } catch {
      setStreamError(
        t('ai.couldNotComplete', { defaultValue: 'I couldn’t complete that action.' }),
      )
    } finally {
      setApplying(false)
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

  const serverMessages = messages.data ?? []
  const serverHasOptimisticUser =
    optimisticUser &&
    serverMessages.some(
      (message) =>
        message.role === 'user' &&
        message.content.trim() === optimisticUser.content.trim() &&
        Math.abs(new Date(message.created_at).getTime() - new Date(optimisticUser.created_at).getTime()) <
          120_000,
    )

  const displayedMessages: DraftMessage[] = [
    ...serverMessages,
    ...(optimisticUser && !serverHasOptimisticUser ? [optimisticUser] : []),
    ...(draft ? [draft] : []),
  ]

  const chatTitle = selectedConversation?.title || t('ai.newChat')
  const isEmpty = !displayedMessages.length

  return (
    <div className="pb-[env(safe-area-inset-bottom)]">
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

      <Card className="relative flex min-h-[calc(100dvh-15rem)] flex-col overflow-hidden">
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

        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            onTouchStart={handleScrollTouchStart}
            className="relative min-h-0 flex-1 touch-pan-y space-y-4 overflow-y-auto overscroll-y-contain p-4 sm:space-y-5 sm:p-6"
          >
            {isEmpty ? (
              <AiSuggestedPrompts
                os={osMode}
                disabled={streaming}
                onSelect={(prompt) => void sendMessage(prompt)}
              />
            ) : (
              displayedMessages.map((message) => {
                const isUser = message.role === 'user'
                const thinking = Boolean(message.pending && !message.content)
                return (
                  <div
                    key={message.id}
                    className={cn(
                      'ai-message-enter flex',
                      isUser ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[min(92%,42rem)] rounded-2xl px-4 py-3 transition-shadow',
                        isUser
                          ? 'bg-accent text-accent-fg shadow-sm'
                          : 'border border-border-subtle bg-surface-2 text-foreground',
                      )}
                    >
                      {thinking ? (
                        <AiThinkingIndicator
                          label={t('ai.thinking', { defaultValue: 'Thinking' })}
                        />
                      ) : message.content ? (
                        <div className="relative">
                          <AiMarkdown content={message.content} inverse={isUser} />
                          {draft?.id === message.id && streaming ? (
                            <span
                              className="ms-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-current/70 align-middle"
                              aria-hidden
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}

            {streamError ? (
              <div className="ai-message-enter mx-auto w-full max-w-md rounded-2xl border border-border-subtle bg-surface/70 px-4 py-3 text-center">
                <p className="text-sm font-medium">
                  {t('ai.somethingWrong', { defaultValue: 'Something went wrong' })}
                </p>
                <p className="mt-1 text-xs text-muted">{streamError}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => {
                    const again = retryMessage
                    setStreamError(null)
                    setRetryMessage(null)
                    if (again) void sendMessage(again)
                  }}
                >
                  {t('ai.tryAgain', { defaultValue: 'Try again' })}
                </Button>
              </div>
            ) : null}

            {actionRun.length ? (
              <div className="ai-message-enter mx-auto w-full max-w-lg">
                <AiActionProgress items={actionRun} collapsedSummary={actionSummary} />
              </div>
            ) : null}

            <div ref={bottomRef} className="h-px w-full" />
          </div>

          {showJump ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center sm:bottom-32">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="pointer-events-auto shadow-md"
                onClick={() => scrollToBottom(true)}
              >
                <ArrowDown className="size-3.5" />
                {t('ai.newResponse', { defaultValue: 'New response' })}
              </Button>
            </div>
          ) : null}

          {proposedActions.length ? (
            <div className="border-t border-border-subtle bg-surface/50 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{t('ai.actions')}</p>
                <Button size="sm" disabled={applying} onClick={() => void executeActions()}>
                  {applying ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}{' '}
                  {t('ai.apply')}
                </Button>
              </div>
              <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">
                {flattenProposedActionLabels(proposedActions, osMode).map((row) => (
                  <span
                    key={row.key}
                    className="rounded-lg border border-border-subtle bg-surface-2 px-2.5 py-1.5 text-xs text-muted"
                  >
                    {row.label}
                    {row.risk ? (
                      <span className="ms-1 text-[10px] uppercase text-warning">{row.risk}</span>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t('ai.confirmTitle', { defaultValue: 'Confirm actions' })}</DialogTitle>
                <DialogDescription>
                  {t('ai.confirmDesc', {
                    defaultValue:
                      'These actions include confirm or destructive steps. Review before applying.',
                  })}
                </DialogDescription>
              </DialogHeader>
              <ul className="max-h-48 space-y-2 overflow-auto text-sm">
                {flattenProposedActionLabels(proposedActions, osMode).map((row) => (
                  <li key={`${row.key}-confirm`} className="rounded-lg bg-surface-2 px-3 py-2">
                    <span className="font-medium">{row.label}</span>
                    {row.risk ? (
                      <span className="ms-2 text-xs text-muted">{row.risk}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button onClick={() => void runActions()}>
                  {t('ai.confirmApply', { defaultValue: 'Confirm & apply' })}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <form
            className="sticky bottom-0 border-t border-border-subtle bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md"
            onSubmit={(event) => {
              event.preventDefault()
              void sendMessage()
            }}
          >
            {voiceMode ? (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/25 bg-accent/5 px-2.5 py-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="relative flex size-2.5 shrink-0">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent/50" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
                  </span>
                  <p className="min-w-0 flex-1 truncate text-xs text-muted">
                    {dictation.listening
                      ? dictation.interim
                        ? t('ai.voiceHearing', { text: dictation.interim })
                        : t('ai.voiceListening')
                      : streaming
                        ? t('ai.voiceWaiting')
                        : t('ai.voiceHint')}
                  </p>
                </div>
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
                'flex items-end gap-2 rounded-2xl border bg-surface-2/60 p-2 shadow-sm transition-colors',
                'focus-within:border-accent/45 focus-within:bg-surface-2/80 focus-within:shadow-md',
                voiceMode ? 'border-accent/40' : 'border-border',
                streaming && 'opacity-95',
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
                className={cn(
                  'shrink-0',
                  voiceMode && 'ring-2 ring-accent/30 ring-offset-1 ring-offset-background',
                )}
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
                className="min-h-10 max-h-40 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
                rows={1}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || streaming}
                aria-label={t('ai.send')}
                className="shrink-0 transition-transform active:scale-95"
              >
                {streaming ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
