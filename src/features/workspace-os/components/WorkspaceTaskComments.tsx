import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  createWorkspaceTaskComment,
  deleteWorkspaceTaskComment,
  listWorkspaceTaskComments,
  updateWorkspaceTaskComment,
  workspaceCommentKeys,
} from '@/features/workspace-os/comments-api'
import { listWorkspaceMembers } from '@/features/workspace-os/api'
import {
  WorkspaceMentionInput,
  displayToTokens,
  tokensToDisplay,
} from '@/features/workspace-os/components/WorkspaceMentionInput'
import { renderMentionContent } from '@/features/workspace-os/lib/task-refs'
import { resolveMemberDisplayName } from '@/features/workspace-os/lib/member-display'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

export function WorkspaceTaskComments({
  workspaceId,
  taskId,
  canEdit,
}: {
  workspaceId: string
  taskId: string
  canEdit: boolean
}) {
  const { user } = useAuth()
  const { t, i18n } = useTranslation()
  const dateLocale = i18n.language.startsWith('ar') ? ar : enUS
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const highlightId = params.get('comment')
  const listRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const comments = useQuery({
    queryKey: workspaceCommentKeys.list(workspaceId, taskId),
    queryFn: () => listWorkspaceTaskComments(workspaceId, taskId),
  })
  const members = useQuery({
    queryKey: ['workspace-os', 'members', workspaceId],
    queryFn: () => listWorkspaceMembers(workspaceId),
  })

  const mentionMembers = useMemo(
    () =>
      (members.data ?? []).map((m) => ({
        id: m.user_id,
        label: resolveMemberDisplayName({
          displayNameOverride: m.display_name_override,
          displayName: m.profiles?.display_name,
          email: m.email ?? m.profiles?.email,
        }),
      })),
    [members.data],
  )

  const nameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of mentionMembers) {
      map[m.id] = m.label
      map[m.id.toLowerCase()] = m.label
    }
    return map
  }, [mentionMembers])

  useEffect(() => {
    const channel = supabase
      .channel(`ws-comments-${workspaceId}-${taskId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_task_comments',
          filter: `task_id=eq.${taskId}`,
        },
        () => {
          void qc.invalidateQueries({
            queryKey: workspaceCommentKeys.list(workspaceId, taskId),
          })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [workspaceId, taskId, qc])

  useEffect(() => {
    if (!highlightId || !comments.data?.length) return
    const el = document.getElementById(`ws-comment-${highlightId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId, comments.data])

  const create = useMutation({
    mutationFn: () =>
      createWorkspaceTaskComment(workspaceId, taskId, displayToTokens(draft, mentionMembers)),
    onSuccess: async () => {
      setDraft('')
      await qc.invalidateQueries({ queryKey: workspaceCommentKeys.list(workspaceId, taskId) })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const update = useMutation({
    mutationFn: () =>
      updateWorkspaceTaskComment(
        workspaceId,
        editingId!,
        displayToTokens(editDraft, mentionMembers),
      ),
    onSuccess: async () => {
      setEditingId(null)
      setEditDraft('')
      await qc.invalidateQueries({ queryKey: workspaceCommentKeys.list(workspaceId, taskId) })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (commentId: string) => deleteWorkspaceTaskComment(workspaceId, commentId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceCommentKeys.list(workspaceId, taskId) })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <section className="space-y-3 border-t border-border-subtle pt-4">
      <h2 className="text-sm font-medium">{t('comments.title')}</h2>
      <div ref={listRef} className="space-y-3">
        {(comments.data ?? []).map((comment) => {
          const isMine = comment.author_user_id === user?.id
          const highlighted = comment.id === highlightId
          return (
            <article
              key={comment.id}
              id={`ws-comment-${comment.id}`}
              className={cn(
                'rounded-xl border border-border-subtle bg-surface/50 px-3 py-2.5',
                highlighted && 'border-border ring-1 ring-fg/20',
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {comment.author?.display_name ?? 'Member'}
                </p>
                <time className="shrink-0 text-[11px] text-muted">
                  {formatDistanceToNow(new Date(comment.created_at), {
                    addSuffix: true,
                    locale: dateLocale,
                  })}
                  {comment.updated_at !== comment.created_at ? ` · ${t('comments.edited')}` : ''}
                </time>
              </div>
              {editingId === comment.id ? (
                <div className="mt-2 space-y-2">
                  <WorkspaceMentionInput
                    value={editDraft}
                    onChange={setEditDraft}
                    members={mentionMembers}
                    placeholder={t('comments.placeholder')}
                    disabled={update.isPending}
                    onSubmit={() => update.mutate()}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={update.isPending || !editDraft.trim()}
                      onClick={() => update.mutate()}
                    >
                      {t('comments.save')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(null)
                        setEditDraft('')
                      }}
                    >
                      {t('comments.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg/90">
                  {renderMentionContent(comment.content, nameById).map((part, i) =>
                    part.type === 'mention' ? (
                      <span key={i} className="font-medium text-fg">
                        @{part.label}
                      </span>
                    ) : (
                      <span key={i}>{part.value}</span>
                    ),
                  )}
                </p>
              )}
              {isMine && editingId !== comment.id ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-muted hover:text-fg"
                    onClick={() => {
                      setEditingId(comment.id)
                      setEditDraft(tokensToDisplay(comment.content, mentionMembers))
                    }}
                  >
                    {t('comments.edit')}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted hover:text-danger"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(comment.id)}
                  >
                    {t('comments.delete')}
                  </button>
                </div>
              ) : null}
            </article>
          )
        })}
        {!comments.data?.length && !comments.isLoading ? (
          <p className="text-sm text-muted">{t('comments.empty')}</p>
        ) : null}
      </div>
      {canEdit ? (
        <div className="space-y-2">
          <WorkspaceMentionInput
            value={draft}
            onChange={setDraft}
            members={mentionMembers}
            placeholder={t('comments.placeholder')}
            disabled={create.isPending}
            onSubmit={() => create.mutate()}
          />
          <Button
            size="sm"
            disabled={create.isPending || !draft.trim()}
            onClick={() => create.mutate()}
          >
            {t('comments.submit')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
