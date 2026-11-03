import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowRightLeft, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
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

export function TransferProjectDialog({
  project,
  targets,
  onClose,
}: {
  project: Project | null
  targets: TransferTarget[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState<'review' | 'confirm'>('review')
  const [workspaceId, setWorkspaceId] = useState('')
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!project) return
    setStep('review')
    setTyped('')
    setWorkspaceId(targets[0]?.id ?? '')
  }, [project, targets])

  const target = targets.find((item) => item.id === workspaceId) ?? null
  const phrase = project ? transferPhrase(project.name) : ''
  const matches = Boolean(project && matchesTransferPhrase(typed, project.name))

  const transfer = useMutation({
    mutationFn: () =>
      transferProjectToWorkspace({ projectId: project!.id, workspaceId, confirmation: typed }),
    onSuccess: async (result) => {
      toast.success(t('projects.transfer.done', { name: project?.name ?? '', workspace: target?.name ?? '' }))
      if (result.pendingFiles > 0) toast.warning(t('projects.transfer.filesPending'))
      onClose()
      qc.removeQueries({ queryKey: projectsKeys.all })
      void qc.invalidateQueries()
      navigate(`/workspace/${result.workspaceId}/projects/${result.projectId}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Dialog open={Boolean(project)} onOpenChange={(next) => !next && !transfer.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('projects.transfer.title', { name: project?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('projects.transfer.body')}</DialogDescription>
        </DialogHeader>

        {step === 'review' ? (
          <div className="space-y-4">
            <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
              <li>{t('projects.transfer.assignees')}</li>
              <li>{t('projects.transfer.subtasks')}</li>
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
              <Button variant="ghost" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button disabled={!target} onClick={() => setStep('confirm')}>
                {t('projects.transfer.continue')}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (matches && !transfer.isPending) transfer.mutate()
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
                disabled={transfer.isPending}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={transfer.isPending} onClick={() => setStep('review')}>
                {t('common.back')}
              </Button>
              <Button type="submit" variant="destructive" disabled={!matches || transfer.isPending}>
                {transfer.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}
                {transfer.isPending ? t('projects.transfer.working') : t('projects.transfer.submit')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
