import { StorageProviderError, type StorageProvider } from './provider.ts'

/**
 * Cloudflare R2 (S3-compatible) slot. Not active: no R2 account or keys exist and no files use it.
 * Enabling it means implementing these methods with the S3 API (SigV4) and setting R2_ACCOUNT_ID,
 * R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY on the server. R2 has no RLS: every R2 access must
 * be authorized in Postgres first (storage_files RLS / storage_* functions) and then served through
 * a server-issued presigned URL.
 */
export function createR2StorageProvider(): StorageProvider {
  const notConfigured = () => {
    throw new StorageProviderError('r2', 'not_configured', 'Cloudflare R2 is not configured for Hilm')
  }
  return {
    name: 'r2',
    deleteObjects: async () => notConfigured(),
    headObject: async () => notConfigured(),
    createSignedDownloadUrl: async () => notConfigured(),
    getObject: async () => notConfigured(),
    putObject: async () => notConfigured(),
  }
}
