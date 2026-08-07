import { useSyncExternalStore } from 'react';

/**
 * Whether this device has a network at all, as a React value.
 *
 * Deliberately *not* the sync engine's status: that one is about a relationship with the diary's
 * server (it can be `needsAuth`, or `unreachable`, or held back by a preference, and it stays
 * silent altogether on a local-only device). This answers the narrower question that the browser
 * itself can answer — "would a fetch have anywhere to go" — which is what anything downloading a
 * static asset needs to know.
 *
 * `navigator.onLine` is an optimist: it says true for a connection that reaches no further than
 * the router. That is the right bias here. Every caller uses this to decide whether to *offer*
 * something, and the pessimistic case has to be handled anyway — the attempt can still fail.
 */
const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

export const useOnline = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
