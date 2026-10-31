import type { ProviderRegistry } from './provider.ts'
import { createR2StorageProvider } from './r2-provider.ts'
import { createSupabaseStorageProvider } from './supabase-provider.ts'
import { workerAuthConfig } from './worker-auth.ts'

/** Providers available to server jobs. Supabase is missing when the worker account is not configured. */
export function storageProviders(env: Record<string, string | undefined> = process.env): ProviderRegistry {
  const registry: ProviderRegistry = { r2: createR2StorageProvider() }
  const config = workerAuthConfig(env)
  if (config) registry.supabase = createSupabaseStorageProvider(config)
  return registry
}
