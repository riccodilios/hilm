import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Building2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { getSettings, updateSettings, settingsKeys } from '@/features/settings/api'
import { createWorkspace, joinWorkspaceByInvite, workspaceKeys } from '@/features/workspace-os/api'
import { resolvePostAuthDestination } from '@/features/auth/startup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/page'
import { cn } from '@/lib/utils'
import type { StartupMode } from '@/features/workspace-os/lib/permissions'

type Step = 'choose' | 'workspace-path'

export function OnboardingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: settingsKeys.me(), queryFn: getSettings })
  const [step, setStep] = useState<Step>('choose')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<'create' | 'join' | null>(null)
  const [doneRedirect, setDoneRedirect] = useState<string | null>(null)

  useEffect(() => {
    if (!settings.data?.onboarding_completed) return
    void resolvePostAuthDestination().then(setDoneRedirect)
  }, [settings.data?.onboarding_completed])

  if (settings.isLoading || (settings.data?.onboarding_completed && !doneRedirect)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Skeleton className="h-10 w-48" />
      </div>
    )
  }

  if (doneRedirect) return <Navigate to={doneRedirect} replace />

  const finish = useMutation({
    mutationFn: async (startup: StartupMode) => {
      await updateSettings({
        onboarding_completed: true,
        default_startup_mode: startup,
      })
      return startup
    },
    onSuccess: async (startup) => {
      await qc.invalidateQueries({ queryKey: settingsKeys.me() })
      navigate(startup === 'workspace' ? '/workspace' : '/personal')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const create = useMutation({
    mutationFn: async () => {
      await updateSettings({
        onboarding_completed: true,
        default_startup_mode: 'workspace',
      })
      const ws = await createWorkspace({ name })
      return ws
    },
    onSuccess: async (ws) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: settingsKeys.me() }),
        qc.invalidateQueries({ queryKey: workspaceKeys.list() }),
      ])
      navigate(`/workspace/${ws.id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const join = useMutation({
    mutationFn: async () => {
      await updateSettings({
        onboarding_completed: true,
        default_startup_mode: 'workspace',
      })
      return joinWorkspaceByInvite(code)
    },
    onSuccess: async (ws) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: settingsKeys.me() }),
        qc.invalidateQueries({ queryKey: workspaceKeys.list() }),
      ])
      navigate(`/workspace/${ws.id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-4 py-10">
      <p className="text-xs uppercase tracking-[0.18em] text-accent">{t('brand.name')}</p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">{t('onboarding.title')}</h1>
      <p className="mt-2 text-muted">{t('onboarding.subtitle')}</p>

      {step === 'choose' ? (
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => finish.mutate('personal')}
            className="rounded-3xl border border-border-subtle bg-surface/40 p-6 text-start transition hover:border-accent/40 hover:bg-surface"
          >
            <UserRound className="size-8 text-accent" />
            <p className="mt-4 text-xl font-medium">{t('os.personal')}</p>
            <p className="mt-2 text-sm text-muted">{t('onboarding.personalDesc')}</p>
          </button>
          <button
            type="button"
            onClick={() => setStep('workspace-path')}
            className="rounded-3xl border border-border-subtle bg-surface/40 p-6 text-start transition hover:border-accent/40 hover:bg-surface"
          >
            <Building2 className="size-8 text-accent" />
            <p className="mt-4 text-xl font-medium">{t('os.workspace')}</p>
            <p className="mt-2 text-sm text-muted">{t('onboarding.workspaceDesc')}</p>
          </button>
        </div>
      ) : (
        <div className="mt-10 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['create', 'join'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={cn(
                  'rounded-xl border px-4 py-2 text-sm',
                  mode === item
                    ? 'border-accent/40 bg-accent/10 text-foreground'
                    : 'border-border-subtle text-muted',
                )}
              >
                {item === 'create' ? t('workspace.create') : t('workspace.join')}
              </button>
            ))}
            <Button variant="ghost" onClick={() => finish.mutate('personal')}>
              {t('onboarding.skip')}
            </Button>
          </div>

          {mode === 'create' ? (
            <div className="rounded-2xl border border-border-subtle bg-surface/40 p-5">
              <Label htmlFor="ob-name">{t('workspace.name')}</Label>
              <Input id="ob-name" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
              <Button
                className="mt-4"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                {t('workspace.create')}
              </Button>
            </div>
          ) : null}

          {mode === 'join' ? (
            <div className="rounded-2xl border border-border-subtle bg-surface/40 p-5">
              <Label htmlFor="ob-code">{t('workspace.inviteCode')}</Label>
              <Input
                id="ob-code"
                className="mt-1 font-mono uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <Button
                className="mt-4"
                disabled={!code.trim() || join.isPending}
                onClick={() => join.mutate()}
              >
                {t('workspace.join')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
