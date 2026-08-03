import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link2, Plug } from 'lucide-react'
import { toast } from 'sonner'
import {
  CRM_PROVIDERS,
  crmKeys,
  disconnectCrmIntegration,
  listCrmIntegrations,
  providerLabel,
  upsertCrmIntegration,
  type CrmProvider,
} from '@/features/workspace-os/crm-api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader, Skeleton } from '@/components/ui/page'

const PROVIDER_DOCS: Record<CrmProvider, string> = {
  salesforce:
    'Configure a Connected App in Salesforce. Store the client ID and secret as encrypted credentials. Sync accounts and opportunities on a schedule.',
  hubspot:
    'Create a private app in HubSpot with CRM scopes. Map deal stages to workspace project statuses.',
  zoho: 'Generate OAuth credentials in Zoho CRM API console. Enable module sync for Leads and Deals.',
  dynamics:
    'Register an Azure AD application for Dynamics 365. Use organization URL and tenant ID in sync settings.',
  custom_rest:
    'Provide a REST base URL and bearer token. Hilm will poll configured endpoints — no live calls are made in this preview.',
}

export function WorkspaceCrmPage() {
  const { t } = useTranslation()
  const { workspaceId, canManage } = useWorkspace()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<CrmProvider>('salesforce')
  const [displayName, setDisplayName] = useState('')
  const [credentials, setCredentials] = useState('')

  const integrations = useQuery({
    queryKey: crmKeys.integrations(workspaceId),
    queryFn: () => listCrmIntegrations(workspaceId),
  })

  const configured = new Map(
    (integrations.data ?? []).map((row) => [row.provider, row]),
  )

  const save = useMutation({
    mutationFn: () =>
      upsertCrmIntegration(workspaceId, {
        provider: selected,
        displayName: displayName.trim() || providerLabel(selected),
        syncSettings: { pollIntervalMinutes: 60, modules: ['accounts', 'deals'] },
        credentialsStub: credentials.trim() || undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: crmKeys.integrations(workspaceId) })
      setCredentials('')
      toast.success(t('workspace.crmSaved', { defaultValue: 'Integration saved' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const disconnect = useMutation({
    mutationFn: (provider: CrmProvider) => disconnectCrmIntegration(workspaceId, provider),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: crmKeys.integrations(workspaceId) })
      toast.success(t('workspace.crmDisconnected', { defaultValue: 'Disconnected' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div>
      <PageHeader
        title={t('workspace.crmTitle', { defaultValue: 'CRM integrations' })}
        description={t('workspace.crmDesc', {
          defaultValue: 'Connect external CRM systems. Configuration only — no live sync yet.',
        })}
      />

      {integrations.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CRM_PROVIDERS.map((provider) => {
            const row = configured.get(provider)
            const active = row?.status === 'configured' || row?.status === 'connected'
            return (
              <button
                key={provider}
                type="button"
                onClick={() => setSelected(provider)}
                className={`rounded-xl border p-4 text-start transition-colors ${
                  selected === provider
                    ? 'border-accent bg-surface-2'
                    : 'border-border-subtle bg-surface/40 hover:bg-surface-2/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Plug className="size-4 text-muted" />
                  <span className="text-sm font-medium">{providerLabel(provider)}</span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {active
                    ? t('workspace.crmConfigured', { defaultValue: 'Configured' })
                    : t('workspace.crmNotConfigured', { defaultValue: 'Not configured' })}
                </p>
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4" />
              {providerLabel(selected)}
            </CardTitle>
            <CardDescription>
              {t('workspace.crmConfigureDesc', {
                defaultValue: 'Save credentials and sync settings locally.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
              placeholder={t('workspace.crmDisplayName', { defaultValue: 'Display name' })}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={!canManage}
            />
            <textarea
              className="min-h-20 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
              placeholder={t('workspace.crmCredentials', {
                defaultValue: 'Credentials (stored as base64 stub)',
              })}
              value={credentials}
              onChange={(e) => setCredentials(e.target.value)}
              disabled={!canManage}
            />
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                  {t('common.save', { defaultValue: 'Save' })}
                </Button>
                {configured.has(selected) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disconnect.isPending}
                    onClick={() => disconnect.mutate(selected)}
                  >
                    {t('workspace.crmDisconnect', { defaultValue: 'Disconnect' })}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted">{t('workspace.readOnlySettings')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('workspace.crmDocs', { defaultValue: 'Documentation' })}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted">{PROVIDER_DOCS[selected]}</p>
            <ul className="mt-4 space-y-2 text-xs text-muted">
              <li>{t('workspace.crmDocSync', { defaultValue: 'Sync runs on a configurable schedule.' })}</li>
              <li>{t('workspace.crmDocSecurity', { defaultValue: 'Credentials are stored encrypted at rest.' })}</li>
              <li>{t('workspace.crmDocPreview', { defaultValue: 'No outbound API calls in this preview.' })}</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
