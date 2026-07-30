import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  deleteWorkspace,
  listWorkspaceMembers,
  transferOwnership,
  updateWorkspace,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page'

export function WorkspaceSettingsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { workspaceId, workspace, canManage, canDelete } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description ?? '')
  const [color, setColor] = useState(workspace.color)
  const [transferTo, setTransferTo] = useState('')

  const members = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => listWorkspaceMembers(workspaceId),
    enabled: canDelete,
  })

  const save = useMutation({
    mutationFn: () =>
      updateWorkspace(workspaceId, {
        name,
        description: description || null,
        color,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.list() })
      toast.success(t('workspace.settingsSaved'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const transfer = useMutation({
    mutationFn: () => transferOwnership(workspaceId, transferTo),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) })
      toast.success(t('workspace.ownershipTransferred'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: () => deleteWorkspace(workspaceId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.list() })
      toast.success(t('workspace.deleted'))
      navigate('/workspace')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div>
      <PageHeader title={t('nav.settings')} description={t('workspace.settingsDesc')} />

      <div className="mt-6 max-w-lg space-y-4 rounded-2xl border border-border-subtle bg-surface/40 p-4">
        <div>
          <Label htmlFor="ws-name">{t('workspace.name')}</Label>
          <Input
            id="ws-name"
            className="mt-1"
            value={name}
            disabled={!canManage}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ws-desc">{t('workspace.description')}</Label>
          <Input
            id="ws-desc"
            className="mt-1"
            value={description}
            disabled={!canManage}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ws-color">{t('workspace.color')}</Label>
          <Input
            id="ws-color"
            type="color"
            className="mt-1 h-10"
            value={color}
            disabled={!canManage}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        {canManage ? (
          <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        ) : (
          <p className="text-sm text-muted">{t('workspace.readOnlySettings')}</p>
        )}
      </div>

      {canDelete ? (
        <div className="mt-8 max-w-lg space-y-4 rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <h2 className="text-sm font-medium text-danger">{t('workspace.dangerZone')}</h2>
          <div>
            <Label>{t('workspace.transferOwnership')}</Label>
            <select
              className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm"
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
            >
              <option value="">{t('workspace.selectMember')}</option>
              {(members.data ?? [])
                .filter((m) => m.user_id !== user?.id)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profiles?.display_name || m.user_id.slice(0, 8)}
                  </option>
                ))}
            </select>
            <Button
              className="mt-2"
              variant="secondary"
              disabled={!transferTo || transfer.isPending}
              onClick={() => transfer.mutate()}
            >
              {t('workspace.transfer')}
            </Button>
          </div>
          <Button
            variant="ghost"
            className="text-danger"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(t('workspace.deleteConfirm'))) remove.mutate()
            }}
          >
            {t('workspace.deleteWorkspace')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
