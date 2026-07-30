import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  createWorkspace,
  joinWorkspaceByInvite,
  listMyWorkspaces,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader, Skeleton } from '@/components/ui/page'

/** Personal OS bridge into Workspace OS. */
export function PersonalWorkspacesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')

  const list = useQuery({ queryKey: workspaceKeys.list(), queryFn: listMyWorkspaces })

  const create = useMutation({
    mutationFn: () => createWorkspace({ name }),
    onSuccess: async (ws) => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.list() })
      navigate(`/workspace/${ws.id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const join = useMutation({
    mutationFn: () => joinWorkspaceByInvite(code),
    onSuccess: async (ws) => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.list() })
      navigate(`/workspace/${ws.id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div>
      <PageHeader title={t('nav.workspace')} description={t('personal.workspaceBridgeDesc')} />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> {t('workspace.create')}
        </Button>
        <Button variant="secondary" onClick={() => setJoinOpen(true)}>
          {t('workspace.join')}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/workspace">{t('workspace.allWorkspaces')}</Link>
        </Button>
      </div>

      {list.isLoading ? (
        <div className="mt-6 space-y-2"><Skeleton className="h-16" /></div>
      ) : (
        <div className="mt-6 space-y-2">
          {(list.data ?? []).map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => navigate(`/workspace/${ws.id}`)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border-subtle bg-surface/40 px-4 py-4 text-start hover:bg-surface"
            >
              <span
                className="flex size-9 items-center justify-center rounded-xl text-sm text-background"
                style={{ backgroundColor: ws.color }}
              >
                {ws.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{ws.name}</p>
                <p className="truncate text-sm text-muted">{ws.description || t('workspace.noDescription')}</p>
              </div>
              <span className="text-[11px] uppercase text-muted">{ws.my_role}</span>
            </button>
          ))}
          {!list.data?.length ? (
            <p className="text-sm text-muted">{t('personal.noWorkspacesYet')}</p>
          ) : null}
        </div>
      )}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-lg font-medium">{t('workspace.create')}</h2>
            <Label htmlFor="pw-name" className="mt-4 block">{t('workspace.name')}</Label>
            <Input id="pw-name" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                {t('workspace.create')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {joinOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-lg font-medium">{t('workspace.join')}</h2>
            <Label htmlFor="pw-code" className="mt-4 block">{t('workspace.inviteCode')}</Label>
            <Input
              id="pw-code"
              className="mt-1 font-mono uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setJoinOpen(false)}>{t('common.cancel')}</Button>
              <Button disabled={!code.trim() || join.isPending} onClick={() => join.mutate()}>
                {t('workspace.join')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
