import { useCallback, useSyncExternalStore } from 'react';

/**
 * A plugin's **device-local** preferences — the half of its settings that must not sync.
 *
 * The line is the one `lib/preferences.ts` draws: anything that arms an alarm stays on the device,
 * because signing out runs `clearLocalData()` and a synced reminder flag would revert to its
 * default and resume buzzing at a time its owner had switched off. A plugin being *enabled* follows
 * the account (see ./enabled); a plugin *reminding you* follows the device.
 *
 * ## Why not `Preferences`
 *
 * The app's own store is one localStorage blob, shallow-merged on load — which is why its keys are
 * flat rather than nested. A `plugins: { habits: {...} }` object inside it would be shadowed whole
 * by any older build's copy, and every sub-key added afterwards would read `undefined`. Plugin keys
 * also come and go with plugins, and `DEFAULT_PREFERENCES` is meant to be a complete, static
 * description of the app's own settings.
 *
 * So each key is its own localStorage entry, `plugin:<id>:<key>`, with the default supplied at the
 * call site. A plugin that is removed leaves behind a few bytes nothing reads, which is the right
 * failure: the alternative is a plugin's reminder time being forgotten because it was disabled for
 * a week.
 */

const storageKey = (pluginId: string, key: string) => `plugin:${pluginId}:${key}`;

/* One subscriber set for all plugin preferences. There are only ever a handful of these on screen
   at once, so waking every listener on any change is cheaper than tracking which key changed. */
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const emit = () => {
  for (const listener of listeners) listener();
};

export function getPluginPreference<T>(pluginId: string, key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey(pluginId, key));
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // Corrupt or unavailable storage degrades to the default rather than throwing, exactly as
    // lib/preferences.ts does — a preference is never worth crashing over.
    return fallback;
  }
}

export function setPluginPreference<T>(pluginId: string, key: string, value: T): void {
  try {
    localStorage.setItem(storageKey(pluginId, key), JSON.stringify(value));
  } catch {
    /* Private-mode storage failures shouldn't lose the in-memory change. */
  }
  emit();
}

/**
 * Read and write one device-local plugin preference.
 *
 * The snapshot is read from storage on every render rather than cached, which is safe only because
 * these are primitives: `useSyncExternalStore` compares by identity, and a string or boolean read
 * twice is the same value. Returning a fresh *object* this way would loop forever — the mistake the
 * comment in lib/preferences.ts exists to prevent.
 */
export function usePluginPreference<T extends string | number | boolean>(
  pluginId: string,
  key: string,
  fallback: T,
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => getPluginPreference(pluginId, key, fallback),
    () => fallback,
  );
  const set = useCallback((next: T) => setPluginPreference(pluginId, key, next), [pluginId, key]);
  return [value, set];
}
