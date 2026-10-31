import { providerErrorFromStatus, StorageProviderError, type DeleteResult, type ObjectInfo, type StorageProvider } from './provider.ts'
import { storageWorkerToken, type WorkerAuthConfig } from './worker-auth.ts'

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/')

/** Supabase Storage through its REST API, acting as the storage worker account. */
export function createSupabaseStorageProvider(config: WorkerAuthConfig, fetchImpl: typeof fetch = fetch): StorageProvider {
  const base = `${config.supabaseUrl}/storage/v1`

  async function request(path: string, init: RequestInit = {}) {
    const token = await storageWorkerToken(config, fetchImpl)
    let response: Response
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, apikey: config.anonKey, ...(init.headers ?? {}) },
      })
    } catch (error) {
      throw new StorageProviderError('supabase', 'unavailable', error instanceof Error ? error.message : 'network error')
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw providerErrorFromStatus('supabase', response.status, `Supabase Storage ${response.status}: ${text.slice(0, 200)}`)
    }
    return response
  }

  return {
    name: 'supabase',

    async deleteObjects(bucket, keys): Promise<DeleteResult> {
      if (!keys.length) return { deleted: [], failed: [] }
      try {
        const response = await request(`/object/${encodeURIComponent(bucket)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: keys }),
        })
        // Deleted rows come back; keys that were already gone are simply absent. Callers confirm
        // against storage.objects, so an absent key is never assumed to be deleted on trust.
        await response.json().catch(() => [])
        return { deleted: keys, failed: [] }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'delete failed'
        return { deleted: [], failed: keys.map((key) => ({ key, error: message })) }
      }
    },

    async headObject(bucket, key): Promise<ObjectInfo | null> {
      try {
        const response = await request(`/object/info/authenticated/${encodeURIComponent(bucket)}/${encodeKey(key)}`)
        const body = (await response.json()) as { size?: number; metadata?: { size?: number; mimetype?: string }; content_type?: string }
        return {
          size: Number(body.size ?? body.metadata?.size ?? 0),
          contentType: body.content_type ?? body.metadata?.mimetype ?? null,
        }
      } catch (error) {
        if (error instanceof StorageProviderError && (error.code === 'not_found' || error.status === 400)) return null
        throw error
      }
    },

    async createSignedDownloadUrl(bucket, key, ttlSeconds) {
      const response = await request(`/object/sign/${encodeURIComponent(bucket)}/${encodeKey(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: ttlSeconds }),
      })
      const body = (await response.json()) as { signedURL?: string }
      if (!body.signedURL) throw new StorageProviderError('supabase', 'unknown', 'no signed URL returned')
      return `${base}${body.signedURL}`
    },

    async getObject(bucket, key) {
      const response = await request(`/object/authenticated/${encodeURIComponent(bucket)}/${encodeKey(key)}`)
      return new Uint8Array(await response.arrayBuffer())
    },

    async putObject() {
      // The worker account has no insert rights; writes happen through user uploads or, for a
      // future migration into Supabase, through a deliberately granted migration account.
      throw new StorageProviderError('supabase', 'unauthorized', 'The storage worker cannot write objects')
    },
  }
}
