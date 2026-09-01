import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  updateMemberPagePermissions,
  workspaceKeys,
  type WorkspaceMember,
} from '@/features/workspace-os/api'
import {
  DEFAULT_MEMBER_PAGE_PERMISSIONS,
  PAGE_LABELS,
  WORKSPACE_PAGES,
  normalizePagePermissions,
  type MemberPagePermissions,
  type WorkspacePageKey,
} from '@/features/workspace-os/lib/page-permissions'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

function editablePagesForRole(role: WorkspaceMember['role']): WorkspacePageKey[] {
  if (role === 'owner' || role === 'admin') return []
  return WORKSPACE_PAGES.filter((page) => page !== 'profile')
}

export function MemberPagePermissionsEditor({
  workspaceId,
  member,
  disabled,
}: {
  workspaceId: string
  member: WorkspaceMember
  disabled?: boolean
}) {
  const qc = useQueryClient()
  const pages = editablePagesForRole(member.role)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<MemberPagePermissions>(() => ({
    ...DEFAULT_MEMBER_PAGE_PERMISSIONS,
    ...normalizePagePermissions(member.page_permissions),
  }))

  const save = useMutation({
    mutationFn: () => updateMemberPagePermissions(workspaceId, member.user_id, draft),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) })
      toast.success('Page permissions saved')
      setOpen(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (!pages.length) return null

  function setPageAccess(page: WorkspacePageKey, field: 'read' | 'write', value: boolean) {
    setDraft((prev) => {
      const current = prev[page] ?? DEFAULT_MEMBER_PAGE_PERMISSIONS[page] ?? { read: false, write: false }
      const next =
        field === 'read'
          ? { read: value, write: value ? current.write : false }
          : { read: current.read, write: value && current.read }
      return { ...prev, [page]: next }
    })
  }

  return (
    <div className="mt-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          setDraft({
            ...DEFAULT_MEMBER_PAGE_PERMISSIONS,
            ...normalizePagePermissions(member.page_permissions),
          })
          setOpen((value) => !value)
        }}
      >
        {open ? 'Hide page access' : 'Configure page access'}
      </Button>
      {open ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border-subtle bg-surface/50 p-3">
          {pages.map((page) => {
            const access = draft[page] ?? DEFAULT_MEMBER_PAGE_PERMISSIONS[page] ?? { read: false, write: false }
            return (
              <div
                key={page}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle py-2 last:border-0"
              >
                <span className="text-sm font-medium">{PAGE_LABELS[page]}</span>
                <div className="flex items-center gap-4 text-xs text-muted">
                  <label className="flex items-center gap-2">
                    Read
                    <Switch
                      checked={access.read}
                      disabled={disabled || save.isPending}
                      onCheckedChange={(checked) => setPageAccess(page, 'read', checked)}
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    Write
                    <Switch
                      checked={access.write}
                      disabled={disabled || save.isPending || !access.read}
                      onCheckedChange={(checked) => setPageAccess(page, 'write', checked)}
                    />
                  </label>
                </div>
              </div>
            )
          })}
          <Button
            type="button"
            size="sm"
            disabled={disabled || save.isPending}
            onClick={() => save.mutate()}
          >
            Save permissions
          </Button>
        </div>
      ) : null}
    </div>
  )
}
