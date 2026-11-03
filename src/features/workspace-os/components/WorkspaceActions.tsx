import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, LoaderCircle, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteWorkspace,
  updateWorkspace,
  workspaceKeys,
  type Workspace,
} from '@/features/workspace-os/api'
import { canDeleteWorkspace, canManageWorkspace, type WorkspaceRole } from '@/features/workspace-os/lib/permissions'
import { useLongPress } from '@/hooks/useLongPress'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type WorkspaceListItem = Workspace & { my_role: WorkspaceRole }

/** A workspace card: a tap opens the workspace, holding (or right-clicking) opens its actions. */
export function HoldableWorkspaceCard({
  workspace,
  onHold,
  className,
  children,
}: {
  workspace: WorkspaceListItem
  onHold: (workspace: WorkspaceListItem) => void
  className?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const held = useRef(false)
  const longPress = useLongPress(() => {
    held.current = true
    onHold(workspace)
  })
  return (
    <button
      type="button"
      className={`touch-manipulation select-none ${className ?? ''}`}
      onClick={() => {
        if (held.current) {
          held.current = false
          return
        }
        navigate(`/workspace/${workspace.id}`)
      }}
      {...longPress}
    >
      {children}
    </button>
  )
}

export function WorkspaceActionsDialog({
  workspace,
  onClose,
}: {
  workspace: WorkspaceListItem | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<'menu' | 'edit' | 'delete'>('menu')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#60a5fa')
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!workspace) return
    setStep('menu')
    setName(workspace.name)
    setDescription(workspace.description ?? '')
    setColor(workspace.color)
    setTyped('')
  }, [workspace])

  const canEdit = canManageWorkspace(workspace?.my_role)
  const canDelete = canDeleteWorkspace(workspace?.my_role)
  const nameMatches = Boolean(workspace && typed.trim() === workspace.name.trim())

  const save = useMutation({
    mutationFn: () => updateWorkspace(workspace!.id, { name: name.trim(), description: description.trim() || null, color }),
    onSuccess: async () => {
      toast.success(t('workspace.settingsSaved'))
      onClose()
      await Promise.all([
        qc.invalidateQueries({ queryKey: workspaceKeys.list() }),
        qc.invalidateQueries({ queryKey: workspaceKeys.detail(workspace!.id) }),
      ])
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: () => deleteWorkspace(workspace!.id),
    onSuccess: async () => {
      const id = workspace!.id
      toast.success(t('workspace.deleted'))
      onClose()
      qc.removeQueries({ queryKey: workspaceKeys.detail(id) })
      await qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const busy = save.isPending || remove.isPending

  return (
    <Dialog open={Boolean(workspace)} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        {step === 'menu' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                {workspace ? (
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-medium text-background"
                    style={{ backgroundColor: workspace.color }}
                  >
                    {workspace.name.slice(0, 1).toUpperCase()}
                  </span>
                ) : null}
                <span className="truncate">{workspace?.name}</span>
              </DialogTitle>
              <DialogDescription>{t('workspace.actions.menuHint')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => {
                  if (!workspace) return
                  const id = workspace.id
                  onClose()
                  navigate(`/workspace/${id}`)
                }}
              >
                <ExternalLink className="size-4" /> {t('workspace.actions.open')}
              </Button>
              {canEdit ? (
                <Button variant="secondary" className="justify-start" onClick={() => setStep('edit')}>
                  <Pencil className="size-4" /> {t('workspace.actions.edit')}
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant="secondary"
                  className="justify-start text-[color:var(--color-danger)]"
                  onClick={() => setStep('delete')}
                >
                  <Trash2 className="size-4" /> {t('workspace.actions.delete')}
                </Button>
              ) : null}
              {!canEdit && !canDelete ? <p className="text-xs text-muted">{t('workspace.actions.noRights')}</p> : null}
            </div>
          </>
        ) : step === 'edit' ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim() && !busy) save.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('workspace.actions.edit')}</DialogTitle>
              <DialogDescription>{t('workspace.actions.editDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="ws-edit-name">{t('workspace.name')}</Label>
              <Input id="ws-edit-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-edit-desc">{t('workspace.description')}</Label>
              <Input id="ws-edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-edit-color">{t('workspace.color')}</Label>
              <Input id="ws-edit-color" type="color" className="h-10" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep('menu')}>
                {t('common.back')}
              </Button>
              <Button type="submit" disabled={!name.trim() || busy}>
                {save.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t('common.save')}
              </Button>
            </div>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (nameMatches && !busy) remove.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('workspace.actions.deleteTitle', { name: workspace?.name ?? '' })}</DialogTitle>
              <DialogDescription>{t('workspace.actions.deleteBody')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="ws-delete-confirm">{t('workspace.actions.typeName')}</Label>
              <p className="rounded-lg bg-surface-3 px-3 py-2 text-sm font-medium break-words">{workspace?.name}</p>
              <Input
                id="ws-delete-confirm"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onPaste={(e) => e.preventDefault()}
                disabled={busy}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep('menu')}>
                {t('common.back')}
              </Button>
              <Button type="submit" variant="destructive" disabled={!nameMatches || busy}>
                {remove.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {t('workspace.actions.delete')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
