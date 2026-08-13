import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import {
  extractMentionUserIds,
  formatWorkspaceTaskRef,
  plainTextFromMentionContent,
} from '@/features/workspace-os/lib/task-refs'
import { getWorkspace, getWorkspaceTask, workspaceKeys } from '@/features/workspace-os/api'
import type { Tables } from '@/types/database'

export type WorkspaceTaskComment = Tables<'workspace_task_comments'> & {
  author?: {
    id: string
    display_name: string
    avatar_url: string | null
  } | null
  mention_ids?: string[]
}

export const workspaceCommentKeys = {
  list: (workspaceId: string, taskId: string) =>
    [...workspaceKeys.task(workspaceId, taskId), 'comments'] as const,
}

export async function listWorkspaceTaskComments(workspaceId: string, taskId: string) {
  const { data, error } = await supabase
    .from('workspace_task_comments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
  if (error) throw error
  const comments = (data ?? []) as Tables<'workspace_task_comments'>[]
  if (!comments.length) return [] as WorkspaceTaskComment[]

  const authorIds = [...new Set(comments.map((c) => c.author_user_id))]
  const commentIds = comments.map((c) => c.id)

  const [{ data: profiles }, { data: mentions }] = await Promise.all([
    supabase.from('profiles').select('id, display_name, avatar_url').in('id', authorIds),
    supabase
      .from('workspace_comment_mentions')
      .select('comment_id, mentioned_user_id')
      .eq('workspace_id', workspaceId)
      .in('comment_id', commentIds),
  ])

  const profileMap = new Map(
    (profiles ?? []).map((p) => [
      p.id,
      {
        id: p.id,
        display_name: p.display_name || p.id.slice(0, 8),
        avatar_url: p.avatar_url,
      },
    ]),
  )
  const mentionsByComment = new Map<string, string[]>()
  for (const row of mentions ?? []) {
    const list = mentionsByComment.get(row.comment_id) ?? []
    list.push(row.mentioned_user_id)
    mentionsByComment.set(row.comment_id, list)
  }

  return comments.map((comment) => ({
    ...comment,
    author: profileMap.get(comment.author_user_id) ?? {
      id: comment.author_user_id,
      display_name: comment.author_user_id.slice(0, 8),
      avatar_url: null,
    },
    mention_ids: mentionsByComment.get(comment.id) ?? [],
  })) satisfies WorkspaceTaskComment[]
}

async function syncCommentMentions(input: {
  workspaceId: string
  commentId: string
  content: string
  previousMentionIds?: string[]
  notifyNew: boolean
  taskId: string
  authorName: string
}) {
  const nextIds = extractMentionUserIds(input.content)
  const prev = new Set((input.previousMentionIds ?? []).map((id) => id.toLowerCase()))
  const next = new Set(nextIds.map((id) => id.toLowerCase()))

  const toAdd = [...next].filter((id) => !prev.has(id))
  const toRemove = [...prev].filter((id) => !next.has(id))

  if (toRemove.length) {
    const { error } = await supabase
      .from('workspace_comment_mentions')
      .delete()
      .eq('comment_id', input.commentId)
      .in('mentioned_user_id', toRemove)
    if (error) throw error
  }

  if (toAdd.length) {
    const { error } = await supabase.from('workspace_comment_mentions').insert(
      toAdd.map((mentioned_user_id) => ({
        workspace_id: input.workspaceId,
        comment_id: input.commentId,
        mentioned_user_id,
      })),
    )
    if (error) throw error
  }

  if (!input.notifyNew || !toAdd.length) return

  const [workspace, task] = await Promise.all([
    getWorkspace(input.workspaceId),
    getWorkspaceTask(input.workspaceId, input.taskId),
  ])
  const shortId =
    formatWorkspaceTaskRef(workspace.task_key, task.task_number) ?? task.title
  const nameById: Record<string, string> = {}
  const snippet = plainTextFromMentionContent(input.content, nameById).slice(0, 140)
  const authorId = await requireUserId()

  const rows = toAdd
    .filter((id) => id !== authorId)
    .map((user_id) => ({
      user_id,
      channel: 'in_app' as const,
      type: 'workspace.task.mention',
      title: 'New mention',
      body: `${input.authorName} mentioned you in ${shortId}\n“${snippet}”`,
      entity_type: 'workspace_task_comment',
      entity_id: input.commentId,
      href: `/workspace/${input.workspaceId}/tasks/${input.taskId}?comment=${input.commentId}`,
      metadata: {
        workspace_id: input.workspaceId,
        task_id: input.taskId,
        comment_id: input.commentId,
        task_ref: shortId,
        author_name: input.authorName,
        snippet,
      },
    }))

  if (rows.length) {
    const { error } = await supabase.from('notifications').insert(rows)
    if (error) throw error
  }
}

export async function createWorkspaceTaskComment(
  workspaceId: string,
  taskId: string,
  content: string,
) {
  const userId = await requireUserId()
  const trimmed = content.trim()
  if (!trimmed) throw new Error('Comment cannot be empty')

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle()

  const { data, error } = await supabase
    .from('workspace_task_comments')
    .insert({
      workspace_id: workspaceId,
      task_id: taskId,
      author_user_id: userId,
      content: trimmed,
    })
    .select('*')
    .single()
  if (error) throw error

  await syncCommentMentions({
    workspaceId,
    commentId: data.id,
    content: trimmed,
    previousMentionIds: [],
    notifyNew: true,
    taskId,
    authorName: profile?.display_name || 'Someone',
  })

  return data as Tables<'workspace_task_comments'>
}

export async function updateWorkspaceTaskComment(
  workspaceId: string,
  commentId: string,
  content: string,
) {
  const userId = await requireUserId()
  const trimmed = content.trim()
  if (!trimmed) throw new Error('Comment cannot be empty')

  const { data: existing, error: existingError } = await supabase
    .from('workspace_task_comments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', commentId)
    .single()
  if (existingError) throw existingError
  if (existing.author_user_id !== userId) throw new Error('You can only edit your own comments')

  const { data: prevMentions } = await supabase
    .from('workspace_comment_mentions')
    .select('mentioned_user_id')
    .eq('comment_id', commentId)

  const { data, error } = await supabase
    .from('workspace_task_comments')
    .update({ content: trimmed })
    .eq('workspace_id', workspaceId)
    .eq('id', commentId)
    .eq('author_user_id', userId)
    .select('*')
    .single()
  if (error) throw error

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle()

  await syncCommentMentions({
    workspaceId,
    commentId,
    content: trimmed,
    previousMentionIds: (prevMentions ?? []).map((row) => row.mentioned_user_id),
    notifyNew: true,
    taskId: existing.task_id,
    authorName: profile?.display_name || 'Someone',
  })

  return data as Tables<'workspace_task_comments'>
}

export async function deleteWorkspaceTaskComment(workspaceId: string, commentId: string) {
  const { error } = await supabase
    .from('workspace_task_comments')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', commentId)
  if (error) throw error
}
