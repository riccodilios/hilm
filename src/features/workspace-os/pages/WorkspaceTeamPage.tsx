import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import { Copy, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  inviteLinkForCode,
  listWorkspaceMembers,
  regenerateInviteCode,
  removeMember,
  updateMemberRole,
  workspaceKeys,
  type WorkspaceMember,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import {
  memberInitials,
  resolveMemberDisplayName,
} from '@/features/workspace-os/lib/member-display'
import type { WorkspaceRole } from '@/features/workspace-os/lib/permissions'
import { Button } from '@/components/ui/button'
import { PageHeader, Skeleton } from '@/components/ui/page'

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer']

function memberLabel(member: WorkspaceMember) {
  return resolveMemberDisplayName({
    displayNameOverride: member.display_name_override,
    displayName: member.profiles?.display_name,
    email: member.email ?? member.profiles?.email,
  })
}

function presenceText(
  member: WorkspaceMember,
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale: typeof enUS,
) {
  if (member.last_active_at) {
    const at = new Date(member.last_active_at).getTime()
    if (Number.isFinite(at) && Date.now() - at < 15 * 60 * 1000) {
      return t('workspace.activeNow')
    }
    return t('workspace.lastActiveRelative', {
      relative: formatDistanceToNow(new Date(member.last_active_at), {
        addSuffix: true,
        locale,
      }),
    })
  }
  return t('workspace.joinedRelative', {
    relative: formatDistanceToNow(new Date(member.joined_at), {
      addSuffix: true,
      locale,
    }),
  })
}

export function WorkspaceTeamPage() {
  const { t, i18n } = useTranslation()
  const { workspaceId, workspace, canManageTeam, role } = useWorkspace()
  const qc = useQueryClient()
  const dateLocale = i18n.language.startsWith('ar') ? ar : enUS
  const members = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => listWorkspaceMembers(workspaceId),
  })

  const regen = useMutation({
    mutationFn: () => regenerateInviteCode(workspaceId),
    onSuccess: async (code) => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) })
      toast.success(t('workspace.inviteRegenerated', { code }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const changeRole = useMutation({
    mutationFn: ({ userId, next }: { userId: string; next: WorkspaceRole }) =>
      updateMemberRole(workspaceId, userId, next),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) })
      toast.success(t('workspace.roleUpdated'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(workspaceId, userId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) })
      toast.success(t('workspace.memberRemoved'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text)
    toast.success(label)
  }

  return (
    <div>
      <PageHeader title={t('nav.team')} description={t('workspace.teamDesc')} />

      {canManageTeam ? (
        <section className="mt-6 rounded-2xl border border-border-subtle bg-surface/40 p-4">
          <p className="text-sm font-medium">{t('workspace.invite')}</p>
          <p className="mt-1 font-mono text-lg tracking-wide">{workspace.invite_code}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => copy(workspace.invite_code, t('workspace.codeCopied'))}
            >
              <Copy className="size-4" /> {t('workspace.copyCode')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                copy(inviteLinkForCode(workspace.invite_code), t('workspace.linkCopied'))
              }
            >
              <Copy className="size-4" /> {t('workspace.copyLink')}
            </Button>
            <Button size="sm" variant="ghost" disabled={regen.isPending} onClick={() => regen.mutate()}>
              <RefreshCw className="size-4" /> {t('workspace.regenerate')}
            </Button>
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded-2xl border border-border-subtle bg-surface/40 p-4">
          <p className="text-sm text-muted">{t('workspace.inviteRestricted')}</p>
        </section>
      )}

      {members.isLoading ? (
        <div className="mt-6 space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {(members.data ?? []).map((member) => {
            const name = memberLabel(member)
            const initials = memberInitials(name)
            const avatarUrl = member.profiles?.avatar_url
            const email = member.email ?? member.profiles?.email
            const roleLabel = t(`workspace.roles.${member.role}`, { defaultValue: member.role })
            return (
              <div
                key={member.user_id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-subtle bg-surface/40 px-4 py-3"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="size-10 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-xs font-medium text-accent"
                    aria-hidden
                  >
                    {initials}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="text-xs text-muted">
                    {roleLabel}
                    {' · '}
                    {presenceText(member, t, dateLocale)}
                  </p>
                  {canManageTeam && email ? (
                    <p className="truncate text-xs text-muted">{email}</p>
                  ) : null}
                  <p className="text-[11px] text-muted">
                    {t('workspace.joinedOn', {
                      date: new Date(member.joined_at).toLocaleDateString(i18n.language),
                    })}
                  </p>
                </div>
                {canManageTeam && member.role !== 'owner' ? (
                  <>
                    <select
                      className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs"
                      value={member.role}
                      disabled={role !== 'owner' && member.role === 'admin'}
                      onChange={(e) =>
                        changeRole.mutate({
                          userId: member.user_id,
                          next: e.target.value as WorkspaceRole,
                        })
                      }
                      aria-label={t('workspace.changeRole')}
                    >
                      {ROLES.filter((r) => r !== 'owner' || role === 'owner').map((r) => (
                        <option key={r} value={r}>
                          {t(`workspace.roles.${r}`, { defaultValue: r })}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(member.user_id)}>
                      {t('common.remove')}
                    </Button>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
