import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowRightLeft, Copy, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  copyProjectToWorkspace,
  matchesTransferPhrase,
  transferPhrase,
  transferProjectToWorkspace,
  type TransferTarget,
} from '@/features/projects/transfer-api'
import { projectsKeys } from '@/features/projects/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { Tables } from '@/types/database'

type Project = Tables<'projects'>
export type ProjectMoveMode = 'transfer' | 'copy'

export function TransferProjectDialog({
  project,
  mode,
  targets,
  onClose,
}: {
  project: Project | null
  mode: ProjectMoveMode
  targets: TransferTarget[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState<'review' | 'confirm'>('review')
  const [workspaceId, setWorkspaceId] = useState('')
  const [typed, setTyped] = useState('')
  const copying = mode === 'copy'
  const text = copying ? 'projects.copy' : 'projects.transfer'

  useEffect(() => {
    if (!project) return
    setStep('review')
    setTyped('')
    setWorkspaceId(targets[0]?.id ?? '')
  }, [project, targets])

  const target = targets.find((item) => item.id === workspaceId) ?? null
  const phrase = project ? transferPhrase(project.name) : ''
  const matches = Boolean(project && matchesTransferPhrase(typed, project.name))

  const run = useMutation({
    mutationFn: () =>
      copying
        ? copyProjectToWorkspace({ projectId: project!.id, workspaceId })
        : transferProjectToWorkspace({ projectId: project!.id, workspaceId, confirmation: typed }),
    onSuccess: async (result) => {
      const href = `/workspace/${result.workspaceId}/projects/${result.projectId}`
      const done = t(`${text}.done`, { name: project?.name ?? '', workspace: target?.name ?? '' })
      if (result.pendingFiles > 0) toast.warning(t('projects.transfer.filesPending'))
      onClose()
      if (copying) {
        toast.success(done, { action: { label: t('projects.copy.open'), onClick: () => navigate(href) } })
        void qc.invalidateQueries()
        return
      }
      toast.success(done)
      qc.removeQueries({ queryKey: projectsKeys.all })
      void qc.invalidateQueries()
      navigate(href)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const submitLabel = run.isPending ? t(`${text}.working`) : t(`${text}.submit`)
  const submitIcon = run.isPending ? (
    <LoaderCircle className="size-4 animate-spin" />
  ) : copying ? (
    <Copy className="size-4" />
  ) : (
    <ArrowRightLeft className="size-4" />
  )

  return (
    <Dialog open={Boolean(project)} onOpenChange={(next) => !next && !run.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`${text}.title`, { name: project?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t(`${text}.body`)}</DialogDescription>
        </DialogHeader>

        {step === 'review' ? (
          <div className="space-y-4">
            <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
              {copying ? <li>{t('projects.copy.once')}</li> : null}
              <li>{t('projects.transfer.assignees')}</li>
              <li>{t('projects.transfer.subtasks')}</li>
              {copying ? <li>{t('projects.copy.notCopied')}</li> : null}
            </ul>
            {targets.length > 1 ? (
              <div className="space-y-2">
                <Label>{t('projects.transfer.chooseWorkspace')}</Label>
                <div className="grid gap-2">
                  {targets.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setWorkspaceId(item.id)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border px-3 py-2 text-start text-sm transition-colors',
                        item.id === workspaceId ? 'border-accent bg-surface' : 'border-border-subtle hover:bg-surface/70',
                      )}
                    >
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color ?? 'var(--color-accent)' }}
                      />
                      <span className="truncate">{item.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : target ? (
              <p className="text-sm">
                {t('projects.transfer.chooseWorkspace')}: <span className="font-medium">{target.name}</span>
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={run.isPending} onClick={onClose}>
                {t('common.cancel')}
              </Button>
              {copying ? (
                <Button disabled={!target || run.isPending} onClick={() => run.mutate()}>
                  {submitIcon}
                  {submitLabel}
                </Button>
              ) : (
                <Button disabled={!target} onClick={() => setStep('confirm')}>
                  {t('projects.transfer.continue')}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (matches && !run.isPending) run.mutate()
            }}
          >
            <div className="space-y-2">
              <p className="text-sm text-muted">{t('projects.transfer.typeToConfirm')}</p>
              <p dir="ltr" className="rounded-lg bg-surface-3 px-3 py-2 font-mono text-sm break-words">
                {phrase}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transfer-confirm">{t('projects.transfer.confirmLabel')}</Label>
              <Input
                id="transfer-confirm"
                dir="ltr"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onPaste={(event) => event.preventDefault()}
                disabled={run.isPending}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={run.isPending} onClick={() => setStep('review')}>
                {t('common.back')}
              </Button>
              <Button type="submit" variant="destructive" disabled={!matches || run.isPending}>
                {submitIcon}
                {submitLabel}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
