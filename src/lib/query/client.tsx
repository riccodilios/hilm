import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get, set, del } from 'idb-keyval'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => (await get(key)) ?? null,
    setItem: async (key, value) => {
      await set(key, value)
    },
    removeItem: async (key) => {
      await del(key)
    },
  },
  key: 'hilm-query-cache',
})

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24,
        buster: 'v2',
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            const root = query.queryKey[0]
            // Keep focus/notifications fresh — don't restore stale dashboard from IndexedDB
            if (root === 'home' || root === 'notifications') return false
            return defaultShouldDehydrateQuery(query)
          },
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
