import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Database and production security tests (npm run test:security). They use isolated test accounts:
 * the RLS suite runs inside one transaction that is always rolled back; the end-to-end suite creates
 * temporary accounts and removes them afterwards. Never part of the default `npm test`.
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['tests/security/**/*.security.ts'],
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
