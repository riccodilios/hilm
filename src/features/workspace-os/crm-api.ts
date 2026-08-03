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
  const credentials_encrypted = input.credentialsStub
    ? btoa(input.credentialsStub)
    : null

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
    credentials_encrypted,
  }

  if (existing?.id) {
    const { data, error } = await supabase
      .from('workspace_crm_integrations')
      .update(patch)
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) throw error
    return data as CrmIntegration
  }

  const { data, error } = await supabase
    .from('workspace_crm_integrations')
    .insert({
      workspace_id: workspaceId,
      provider: input.provider,
      status: 'configured',
      display_name: input.displayName ?? null,
      sync_settings: (input.syncSettings ?? {}) as Json,
      credentials_encrypted,
      created_by: userId,
    } as never)
    .select('*')
    .single()
  if (error) throw error
  return data as CrmIntegration
}

export async function disconnectCrmIntegration(workspaceId: string, provider: CrmProvider) {
  const { error } = await supabase
    .from('workspace_crm_integrations')
    .update({
      status: 'disconnected',
      credentials_encrypted: null,
    })
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
  if (error) throw error
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
