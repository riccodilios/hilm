import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
import { cn } from '@/lib/utils'

export function WorkspaceSelectorPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#60a5fa')
  const [code, setCode] = useState('')

  const list = useQuery({ queryKey: workspaceKeys.list(), queryFn: listMyWorkspaces })

  useEffect(() => {
    if (params.get('create') === '1') setCreateOpen(true)
    const join = params.get('join')
    if (join) {
      setJoinOpen(true)
      if (join !== '1') setCode(join)
    }
  }, [params])

  const create = useMutation({
    mutationFn: () => createWorkspace({ name, description, color }),
    onSuccess: async (ws) => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.list() })
      toast.success(t('workspace.createdToast'))
      navigate(`/workspace/${ws.id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const join = useMutation({
    mutationFn: () => joinWorkspaceByInvite(code),
    onSuccess: async (ws) => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.list() })
      toast.success(t('workspace.joinedToast'))
      navigate(`/workspace/${ws.id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function closeDialogs() {
    setCreateOpen(false)
    setJoinOpen(false)
    setParams({})
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted">{t('os.workspace')}</p>
          <PageHeader title={t('workspace.selectorTitle')} description={t('workspace.selectorDesc')} />
        </div>
        <Button asChild variant="secondary">
          <Link to="/personal">{t('nav.personal')}</Link>
        </Button>
      </div>

      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(list.data ?? []).map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => navigate(`/workspace/${ws.id}`)}
              className="rounded-2xl border border-border-subtle bg-surface/40 p-5 text-start transition hover:border-border hover:bg-surface"
            >
              <span
                className="mb-4 flex size-10 items-center justify-center rounded-xl text-sm font-medium text-background"
                style={{ backgroundColor: ws.color }}
              >
                {ws.name.slice(0, 1).toUpperCase()}
              </span>
              <p className="font-medium">{ws.name}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{ws.description || t('workspace.noDescription')}</p>
              <p className="mt-3 text-[11px] uppercase tracking-wide text-muted">{ws.my_role}</p>
            </button>
          ))}

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className={cn(
              'flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface/20 p-5 text-muted transition hover:border-accent/40 hover:text-foreground',
            )}
          >
            <Plus className="size-6" />
            <span className="text-sm font-medium">{t('workspace.create')}</span>
          </button>

          <button
            type="button"
            onClick={() => setJoinOpen(true)}
            className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface/20 p-5 text-muted transition hover:border-accent/40 hover:text-foreground"
          >
            <span className="text-sm font-medium">{t('workspace.join')}</span>
          </button>
        </div>
      )}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl">
            <h2 className="text-lg font-medium">{t('workspace.create')}</h2>
            <div className="mt-4 space-y-3">
              <div>
                <Label htmlFor="ws-name">{t('workspace.name')}</Label>
                <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="ws-desc">{t('workspace.description')}</Label>
                <Input
                  id="ws-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="ws-color">{t('workspace.color')}</Label>
                <Input
                  id="ws-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="mt-1 h-10"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={closeDialogs}>
                {t('common.cancel')}
              </Button>
              <Button
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                {t('workspace.create')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {joinOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl">
            <h2 className="text-lg font-medium">{t('workspace.join')}</h2>
            <div className="mt-4">
              <Label htmlFor="ws-code">{t('workspace.inviteCode')}</Label>
              <Input
                id="ws-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mt-1 font-mono uppercase"
                placeholder="ABCD1234"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={closeDialogs}>
                {t('common.cancel')}
              </Button>
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
