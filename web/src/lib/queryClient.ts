import { QueryClient } from '@tanstack/react-query';

/**
 * The app's single QueryClient, in its own module rather than inline in main.tsx so that code
 * outside the React tree can read the cache. Everything here is local-first — the queries read
 * Dexie, not the network — so the cache doubles as a synchronous snapshot of the user's data,
 * which is the only way something like a toast helper can consult the account settings without
 * being a hook or going async.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
