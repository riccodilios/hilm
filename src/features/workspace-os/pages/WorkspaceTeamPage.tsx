import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import { Copy, Mail, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  inviteLinkForCode,
  listWorkspaceMembers,
  regenerateInviteCode,
  sendWorkspaceEmailInvites,
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
import { MemberPagePermissionsEditor } from '@/features/workspace-os/components/MemberPagePermissionsEditor'
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

  const [inviteInput, setInviteInput] = useState('')
  const inviteEmails = [
    ...new Set(
      inviteInput
        .split(/[\s,;]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ].slice(0, 10)

  const emailInvite = useMutation({
    mutationFn: (emails: string[]) =>
      sendWorkspaceEmailInvites(workspaceId, emails, i18n.language.startsWith('ar') ? 'ar' : 'en'),
    onSuccess: (results) => {
      const sent = results.filter((r) => r.status === 'sent').length
      const skipped = results.filter((r) => r.status !== 'sent')
      if (sent) toast.success(t('workspace.invitesSent', { count: sent }))
      for (const r of skipped) toast.message(`${r.email}: ${t(`workspace.inviteStatus.${r.status}`)}`)
      if (!skipped.length) setInviteInput('')
    },
    onError: (error: Error & { code?: string }) =>
      toast.error(
        error.code === 'not_configured'
          ? t('workspace.inviteEmailUnavailable')
          : t(`workspace.inviteError.${error.code}`, { defaultValue: t('workspace.inviteEmailFailed') }),
      ),
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
          <form
            className="mt-4 border-t border-border-subtle pt-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (inviteEmails.length) emailInvite.mutate(inviteEmails)
            }}
          >
            <label htmlFor="invite-emails" className="text-sm font-medium">
              {t('workspace.inviteByEmail')}
            </label>
            <p className="mt-0.5 text-xs text-muted">{t('workspace.inviteByEmailHint')}</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="invite-emails"
                type="text"
                inputMode="email"
                autoComplete="off"
                dir="ltr"
                placeholder="name@company.com, teammate@company.com"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-sm"
              />
              <Button size="sm" type="submit" disabled={!inviteEmails.length || emailInvite.isPending}>
                <Mail className="size-4" />
                {emailInvite.isPending ? t('common.loading') : t('workspace.sendInvites')}
              </Button>
            </div>
          </form>
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
                  {role === 'owner' ? (
                    <MemberPagePermissionsEditor
                      workspaceId={workspaceId}
                      member={member}
                      disabled={!canManageTeam}
                    />
                  ) : null}
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
