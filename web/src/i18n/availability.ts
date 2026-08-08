import type { SyncBlocker } from '@/db/sync';

/**
 * Whether a locale chunk could be downloaded right now.
 *
 * Side-effect free and in its own file so it can be tested without booting i18next, the same way
 * `syncPill.ts` holds the pill's predicate away from the layout that renders it.
 *
 * `navigator.onLine` answers "is there a network", which is not the question. The locale files are
 * static assets on our own origin, so a server the sync engine has just failed to reach is a server
 * these cannot come from either — the diary being down, or a captive portal answering every request
 * with its own login page. Both leave `navigator.onLine` cheerfully true, which is how a language
 * that could not possibly load stayed on offer while every other part of the app said so.
 *
 * Only `unreachable` counts:
 *
 *   - `offline` is what the `online` argument already covers, and it is the stronger signal of the
 *     two — no point deriving it twice.
 *   - `paused` is the Wi-Fi-only preference holding *writes* back on purpose. The network is fine
 *     and a locale chunk would come down normally, so greying languages out there would be
 *     inventing a failure the user would have no way to act on.
 *   - `null` is a working server, or a device that has never synced at all — a signed-out user's
 *     blocker never leaves `null`, and their language picker must keep working regardless.
 */
export function canFetchLocales(online: boolean, blocker: SyncBlocker): boolean {
  return online && blocker !== 'unreachable';
}
