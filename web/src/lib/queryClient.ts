import { QueryClient } from '@tanstack/react-query';

/**
 * The app's single QueryClient, in its own module rather than inline in main.tsx so that code
 * outside the React tree can read the cache. Everything here is local-first — the queries read
 * Dexie, not the network — so the cache doubles as a synchronous snapshot of the user's data,
 * which is the only way something like a toast helper can consult the account settings without
 * being a hook or going async.
 */
/* `networkMode: 'always'` is the load-bearing line here, on both halves.

   React Query defaults to 'online', which suits its usual job — a queryFn/mutationFn that makes an
   HTTP call has nothing useful to do while the device is offline, so it parks the work until the
   connection returns. None of that holds in this app: every queryFn reads Dexie and every
   mutationFn writes it, and the outbox is what defers the network part, on its own schedule.

   Under the default, `navigator.onLine === false` meant react-query *paused* mutations instead of
   running them — mutationFn was never called, and the promise from mutateAsync never settled. So
   writing an entry with no connection wrote nothing, queued nothing, and reported nothing: the
   submit button just span forever, because from react-query's point of view the mutation hadn't
   failed, it hadn't started. Queries paused the same way, so a cold start offline came up empty
   with a full local database underneath.

   The one genuinely networked call, POST /ai/suggestions, is better off 'always' too: it fails
   with a real error the caller can show instead of hanging, and its UI is already gated on the
   sync status. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      networkMode: 'always',
    },
  },
});
