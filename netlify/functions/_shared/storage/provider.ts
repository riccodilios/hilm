/**
 * Storage provider interface. Every stored object is recorded in public.storage_files with its own
 * provider and bucket, so files can live on different providers at the same time and move between
 * them without feature code changing. Authorization never relies on the provider: it is decided in
 * Postgres (RLS and the storage_* functions) before a provider is asked to do anything.
 */
export type ProviderName = 'supabase' | 'r2'

export type ObjectInfo = { size: number; contentType: string | null }

export type DeleteResult = { deleted: string[]; failed: Array<{ key: string; error: string }> }

export interface StorageProvider {
  readonly name: ProviderName
  /** Removes objects; reports per key. Missing objects count as deleted. */
  deleteObjects(bucket: string, keys: string[]): Promise<DeleteResult>
  /** Object metadata, or null when it does not exist. */
  headObject(bucket: string, key: string): Promise<ObjectInfo | null>
  /** Short-lived download URL for a server-authorized request. */
  createSignedDownloadUrl(bucket: string, key: string, ttlSeconds: number): Promise<string>
  /** Reads the object (verification and provider migration). */
  getObject(bucket: string, key: string): Promise<Uint8Array>
  /** Writes an object (provider migration). */
  putObject(bucket: string, key: string, body: Uint8Array, contentType: string | null): Promise<void>
}

export type StorageProviderErrorCode = 'not_configured' | 'unauthorized' | 'not_found' | 'unavailable' | 'invalid' | 'unknown'

export class StorageProviderError extends Error {
  readonly provider: ProviderName
  readonly code: StorageProviderErrorCode
  readonly status?: number
  constructor(provider: ProviderName, code: StorageProviderErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'StorageProviderError'
    this.provider = provider
    this.code = code
    this.status = status
  }

  /** Errors worth retrying later (network, 5xx, throttling). */
  get retryable() {
    return this.code === 'unavailable' || this.code === 'unknown'
  }
}

export function providerErrorFromStatus(provider: ProviderName, status: number, message: string) {
  if (status === 401 || status === 403) return new StorageProviderError(provider, 'unauthorized', message, status)
  if (status === 404) return new StorageProviderError(provider, 'not_found', message, status)
  if (status === 400 || status === 409 || status === 413 || status === 415) {
    return new StorageProviderError(provider, 'invalid', message, status)
  }
  if (status === 429 || status >= 500) return new StorageProviderError(provider, 'unavailable', message, status)
  return new StorageProviderError(provider, 'unknown', message, status)
}

export type ProviderRegistry = Partial<Record<ProviderName, StorageProvider>>

export function providerFor(registry: ProviderRegistry, name: string): StorageProvider {
  const provider = registry[name as ProviderName]
  if (!provider) throw new StorageProviderError(name as ProviderName, 'not_configured', `Storage provider "${name}" is not configured`)
  return provider
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
