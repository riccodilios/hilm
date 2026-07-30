import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  inviteLinkForCode,
  listWorkspaceMembers,
  regenerateInviteCode,
  removeMember,
  updateMemberRole,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import type { WorkspaceRole } from '@/features/workspace-os/lib/permissions'
import { Button } from '@/components/ui/button'
import { PageHeader, Skeleton } from '@/components/ui/page'

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer']

export function WorkspaceTeamPage() {
  const { t } = useTranslation()
  const { workspaceId, workspace, canManageTeam, role } = useWorkspace()
  const qc = useQueryClient()
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
          {canManageTeam ? (
            <Button size="sm" variant="ghost" disabled={regen.isPending} onClick={() => regen.mutate()}>
              <RefreshCw className="size-4" /> {t('workspace.regenerate')}
            </Button>
          ) : null}
        </div>
      </section>

      {members.isLoading ? (
        <div className="mt-6 space-y-2"><Skeleton className="h-14" /></div>
      ) : (
        <div className="mt-6 space-y-2">
          {(members.data ?? []).map((member) => (
            <div
              key={member.user_id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-subtle bg-surface/40 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.profiles?.display_name || member.user_id.slice(0, 8)}
                </p>
                <p className="text-xs capitalize text-muted">{member.role}</p>
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
                  >
                    {ROLES.filter((r) => r !== 'owner' || role === 'owner').map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(member.user_id)}
                  >
                    {t('common.remove')}
                  </Button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
