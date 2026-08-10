/**
 * The localStorage cache of which plugins are enabled.
 *
 * Deliberately its own module with no imports at all. The full store in `./enabled` reaches Dexie
 * through `db/pluginRecords`, and `db/db.ts`'s `clearLocalData()` has to be able to drop this cache
 * on sign-out — importing the store from there would close the cycle db → enabled → pluginRecords →
 * db. Same shape as `bumpLookupVersion` living in db.ts rather than repo.ts, and for the same
 * reason.
 *
 * Only ever a cache. The source of truth is the plugins' `config` rows, which sync; this exists so
 * the day-page slot has an answer on the first frame rather than one Dexie round-trip later.
 */

export const ENABLED_MIRROR_KEY = 'plugin:enabled';

export function readEnabledMirror(): string[] {
  try {
    const raw = localStorage.getItem(ENABLED_MIRROR_KEY);
    if (!raw) return [];
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    // Corrupt or unavailable storage costs a frame, not a crash — the Dexie read settles it.
    return [];
  }
}

export function writeEnabledMirror(ids: readonly string[]): void {
  try {
    localStorage.setItem(ENABLED_MIRROR_KEY, JSON.stringify(ids));
  } catch {
    /* Private-mode storage failures shouldn't lose the in-memory value. */
  }
}

/**
 * Drop the cache.
 *
 * Called from `clearLocalData()`, and it has to be: sign-out wipes Dexie but localStorage survives
 * it, so without this the next account to sign in on a shared device would start with the previous
 * account's plugins switched on — before any sync could contradict it.
 */
export function clearEnabledMirror(): void {
  try {
    localStorage.removeItem(ENABLED_MIRROR_KEY);
  } catch {
    /* see writeEnabledMirror */
  }
}
