import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { workspaceKeys } from '@/features/workspace-os/api'
import type { Database, Json, Tables, Updates } from '@/types/database'

export type CrmProvider = Database['public']['Enums']['crm_provider']
export type CrmIntegration = Tables<'workspace_crm_integrations'>

export const CRM_PROVIDERS: CrmProvider[] = [
  'salesforce',
  'hubspot',
  'zoho',
  'dynamics',
  'custom_rest',
]

export const crmKeys = {
  all: (workspaceId: string) => [...workspaceKeys.all, 'crm', workspaceId] as const,
  integrations: (workspaceId: string) => [...crmKeys.all(workspaceId), 'integrations'] as const,
}

export async function listCrmIntegrations(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_crm_integrations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('provider')
  if (error) throw error
  return (data ?? []) as CrmIntegration[]
}

export async function upsertCrmIntegration(
  workspaceId: string,
  input: {
    provider: CrmProvider
    displayName?: string
    syncSettings?: Record<string, unknown>
    credentialsStub?: string
  },
) {
  const userId = await requireUserId()

  const { data: existing } = await supabase
    .from('workspace_crm_integrations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('provider', input.provider)
    .maybeSingle()

  const patch: Updates<'workspace_crm_integrations'> = {
    status: 'configured',
    display_name: input.displayName ?? null,
    sync_settings: (input.syncSettings ?? {}) as Json,
  }

  let integrationId = existing?.id as string | undefined
  if (integrationId) {
    const { error } = await supabase.from('workspace_crm_integrations').update(patch).eq('id', integrationId)
    if (error) throw error
  } else {
    const { data, error } = await supabase
      .from('workspace_crm_integrations')
      .insert({
        workspace_id: workspaceId,
        provider: input.provider,
        status: 'configured',
        display_name: input.displayName ?? null,
        sync_settings: (input.syncSettings ?? {}) as Json,
        created_by: userId,
      } as never)
      .select('id')
      .single()
    if (error) throw error
    integrationId = (data as { id: string }).id
  }

  // Credentials go straight into Supabase Vault; the browser never reads them back.
  if (input.credentialsStub) {
    const { error } = await supabase.rpc('crm_set_credentials', {
      p_integration_id: integrationId,
      p_credentials: input.credentialsStub,
    })
    if (error) throw error
  }

  const { data, error } = await supabase
    .from('workspace_crm_integrations')
    .select('*')
    .eq('id', integrationId)
    .single()
  if (error) throw error
  return data as CrmIntegration
}

export async function disconnectCrmIntegration(workspaceId: string, provider: CrmProvider) {
  const { data, error } = await supabase
    .from('workspace_crm_integrations')
    .update({ status: 'disconnected' })
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (data?.id) {
    const { error: clearError } = await supabase.rpc('crm_set_credentials', {
      p_integration_id: data.id,
      p_credentials: null,
    })
    if (clearError) throw clearError
  }
}

export function providerLabel(provider: CrmProvider): string {
  const labels: Record<CrmProvider, string> = {
    salesforce: 'Salesforce',
    hubspot: 'HubSpot',
    zoho: 'Zoho CRM',
    dynamics: 'Microsoft Dynamics',
    custom_rest: 'Custom REST',
  }
  return labels[provider]
}
