import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveWeekStart, type WeekStart } from './dates';

/**
 * Device-local UI preferences — the "General" block of the Settings page.
 *
 * Deliberately *not* part of the synced SettingsDto: nothing here changes what the server
 * computes, so paying for a Mongoose field, a Zod field and a sync payload would buy nothing.
 * It also means these keep working in local-only mode, exactly like the theme and the language
 * (which predate this store and still own their own localStorage keys).
 *
 * Adding a preference is one line in the interface plus one in DEFAULT_PREFERENCES; unknown keys
 * found in storage are dropped and missing ones fall back, so an older build reading a newer
 * blob (or the reverse) degrades to the default instead of throwing.
 */
export interface Preferences {
  /** Which day the month grids start on. 'auto' follows the active language's own convention. */
  weekStartsOn: WeekStart | 'auto';
}

export const DEFAULT_PREFERENCES: Preferences = {
  weekStartsOn: 'auto',
};

const STORAGE_KEY = 'preferences';

function load(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    // Corrupt or unavailable storage is not worth crashing the app over.
    return DEFAULT_PREFERENCES;
  }
}

/* useSyncExternalStore compares snapshots by identity, so this object is replaced only when
   something actually changes — returning a fresh load() per read would loop forever. */
let current: Preferences = load();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getPreferences = (): Preferences => current;

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private-mode storage failures shouldn't lose the in-memory change.
  }
  emit();
}

export function resetPreferences() {
  current = { ...DEFAULT_PREFERENCES };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see above */
  }
  emit();
}

// Another tab of the same diary changing a preference should be reflected here too. `storage`
// only fires in *other* documents, so this can't feed back into the write above.
window.addEventListener('storage', (event) => {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  current = load();
  emit();
});

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences, getPreferences);
}

/** The first column of every month grid, with 'auto' already resolved against the language. */
export function useWeekStart(): WeekStart {
  const { i18n } = useTranslation();
  const { weekStartsOn } = usePreferences();
  return resolveWeekStart(weekStartsOn, i18n.language);
}
