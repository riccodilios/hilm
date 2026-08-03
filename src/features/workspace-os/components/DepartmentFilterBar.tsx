import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Filter } from 'lucide-react'
import { listDepartments, orgKeys } from '@/features/workspace-os/org-api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { useOrgVisibility } from '@/features/workspace-os/context/OrgVisibilityProvider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function DepartmentFilterBar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { workspaceId } = useWorkspace()
  const {
    visibleDepartmentIds,
    selectedDepartmentIds,
    toggleDepartment,
    selectAllVisible,
    selectHomeOnly,
    homeDepartmentId,
    canSeeAll,
  } = useOrgVisibility()

  const departments = useQuery({
    queryKey: orgKeys.departments(workspaceId),
    queryFn: () => listDepartments(workspaceId),
  })

  const visibleDepts = (departments.data ?? []).filter((d) =>
    visibleDepartmentIds.includes(d.id),
  )

  if (!visibleDepts.length) {
    return (
      <div
        className={cn(
          'rounded-xl border border-border-subtle bg-surface/40 px-3 py-2 text-xs text-muted',
          className,
        )}
      >
        {canSeeAll ? t('workspace.noDepartmentsYet') : t('workspace.setHomeDepartmentHint')}
      </div>
    )
  }

  if (visibleDepts.length <= 1 && !canSeeAll) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface/40 px-3 py-2',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted">
        <Filter className="size-3.5" />
        {t('workspace.departmentFilter')}
      </span>
      {visibleDepts.map((dept) => {
        const checked = selectedDepartmentIds.includes(dept.id)
        return (
          <label
            key={dept.id}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors',
              checked
                ? 'border-accent/40 bg-accent/10 text-foreground'
                : 'border-border-subtle text-muted hover:border-border',
            )}
          >
            <input
              type="checkbox"
              className="size-3.5 accent-current"
              checked={checked}
              onChange={() => toggleDepartment(dept.id)}
            />
            {dept.name}
            {dept.id === homeDepartmentId ? (
              <span className="text-[10px] opacity-70">({t('workspace.homeDept')})</span>
            ) : null}
          </label>
        )
      })}
      <div className="ms-auto flex gap-1">
        {homeDepartmentId ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={selectHomeOnly}
          >
            {t('workspace.filterMine')}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={selectAllVisible}
        >
          {t('workspace.filterAllBelow')}
        </Button>
      </div>
    </div>
  )
}
