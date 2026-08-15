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
  /** Whether times read as 09:00 or 9 AM. 'auto' follows the active language, like weekStartsOn. */
  hourCycle: '12' | '24' | 'auto';

  /* --- Reminders ---------------------------------------------------------------------------
     Every alarm this device schedules. These are here rather than in the synced SettingsDto for
     a reason worth stating: signing out runs clearLocalData(), which wipes db.meta and drops the
     account settings back to DEFAULT_SETTINGS — so a synced `dailyReminder: false` would quietly
     become true again and the phone would resume buzzing at a time the user had turned off. A
     wrong default for a toast is invisible; for an alarm it is the bug this whole block exists to
     remove. localStorage survives sign-out. The times are also meaningless without a timezone,
     and none is stored anywhere: every schedule is built in this device's local time.

     Keys are flat rather than nested under one `notifications` object because load() below
     shallow-merges — a nested blob written by an older build would shadow the defaults whole and
     any sub-key added later would read undefined. */

  /** The "you haven't written today" nudge. */
  dailyReminder: boolean;
  /** `HH:mm` local. */
  dailyReminderTime: string;
  birthdayReminders: boolean;
  birthdayReminderTime: string;
  checkupReminders: boolean;
  /** Defers reminders that have no time of their own — see notificationSchedule.ts. */
  quietHoursStart: string;
  quietHoursEnd: string;

  /** The light tick on every button press. Native only; a no-op on the web either way. */
  haptics: boolean;
  /** Whether an entry's sub-entries start open. Collapsing is still per-entry and per-visit. */
  entriesExpanded: boolean;
  /** Last importance actually saved, for when defaultImportance is null ("remember last used"). */
  lastImportance: number;
  /** Advanced: hold back sync until the device is on wi-fi. Off by default — the diary is text, so
      a month of syncing costs less than one photo, and the failure mode of this being on by
      mistake is a diary that silently stops backing itself up. */
  syncOnWifiOnly: boolean;
  /** Keep the "waiting for wi-fi" pill off screen even when writes are queued.
      Only ever hides *that* pill: going offline and the server being unreachable are failures
      rather than a setting doing its job, and they keep announcing themselves regardless. */
  hidePausedSyncStatus: boolean;
  /** Give each importance level a distinct shape as well as a colour, so the red-to-green ramp
      stops being the only thing separating them. See ImportanceDot. */
  importanceShapes: boolean;
  /** Whether @mentions, #tags and the chips beside them navigate to what they name. On by
      default — they are already painted in a link colour at a link weight, so the honest state
      is the one where they behave like links. Off leaves them as coloured text. See
      lib/entityLinks.ts. */
  entityLinks: boolean;
  /** Whether the day page uses a 2-column layout on large screens when plugin info or birthdays are present. True by default. */
  twoColumnLayout: boolean;
  /** Send crash reports and usage metrics. Whether there is anywhere to send them is decided at
      build time; this is whether to. Device-local like everything else here, and deliberately
      outside the synced settings so opting out on a phone can't be undone by a laptop. */
  telemetry: boolean;
  /** Whether the first-run tour has been shown on this device. Here rather than in the synced
      settings for the same reason as the reminders above, and the consequence is worse: signing out
      runs clearLocalData(), so a synced flag would reset to false and greet someone with a
      three-year diary as a new user. It is also set on reaching AppLayout — see the comment there —
      because anyone who has used the app has falsified the tour's premise.

      Note that resetPreferences() clears this and would replay the tour, which is correct: it is a
      device preference and "reset everything on this device" honestly includes it. The Settings
      page's own "reset to defaults" resets the synced SettingsDto instead and does not touch it. */
  onboardingSeen: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  weekStartsOn: 'auto',
  hourCycle: 'auto',
  // Every default below reproduces the behaviour that used to be hardcoded, so upgrading changes
  // nothing until the user touches something.
  dailyReminder: true,
  dailyReminderTime: '23:45',
  birthdayReminders: true,
  birthdayReminderTime: '09:00',
  checkupReminders: true,
  quietHoursStart: '22:30',
  quietHoursEnd: '08:00',
  haptics: true,
  entriesExpanded: true,
  lastImportance: 3,
  syncOnWifiOnly: false,
  // Off: the pill is the only thing that says writes are piling up on purpose, so hiding it has
  // to be asked for.
  hidePausedSyncStatus: false,
  // Off by default: the shapes are unmistakable once you know to read them, but they are a
  // second alphabet for anyone who doesn't need one.
  importanceShapes: false,
  entityLinks: true,
  twoColumnLayout: true,
  // On by default: this is the only way a crash on someone else's device is ever seen, and the
  // switch below is one tap away for anyone who would rather it weren't.
  telemetry: true,
  // False: a device that has never stored a preference blob has, by definition, never run the app.
  onboardingSeen: false,
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

/* Another tab of the same diary changing a preference should be reflected here too. `storage`
   only fires in *other* documents, so this can't feed back into the write above.

   Guarded, because this is the one statement in the module that assumed a browser. `load()` above
   is already safe (its localStorage read is inside a try/catch), so with this line unguarded the
   module was importable everywhere except at the exact moment it was imported — a `ReferenceError:
   window is not defined` under the node-environment `logic` test project, thrown before any test
   body ran. The chain that reaches it is not obvious from any one file: db/repo.ts → db/outbox.ts →
   db/sync.ts → here, which is why repo.test.ts has to `vi.mock('./sync')` and why db.test.ts
   silently constrains what db.ts is allowed to import. Nothing about a cross-tab listener needs to
   be load-bearing for that. lib/telemetry.ts already follows this rule — its window listeners live
   inside initTelemetry() rather than at module scope. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    current = load();
    emit();
  });
}

/** Subscribe from outside React — used to re-arm the alarms when a reminder preference changes. */
export const subscribePreferences = (listener: () => void) => subscribe(listener);

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences, getPreferences);
}

/** True when the active language (or the user's override) writes times as 9 AM rather than 09:00. */
export function resolveHour12(hourCycle: Preferences['hourCycle'], lng: string): boolean {
  if (hourCycle !== 'auto') return hourCycle === '12';
  // Intl is the authority on what a locale actually does; en-US is 12h, es/it/ja/zh are 24h.
  return new Intl.DateTimeFormat(lng, { hour: 'numeric' }).resolvedOptions().hour12 ?? false;
}

/** Whether to render times as 12- or 24-hour, with 'auto' already resolved against the language. */
export function useHour12(): boolean {
  const { i18n } = useTranslation();
  const { hourCycle } = usePreferences();
  return resolveHour12(hourCycle, i18n.language);
}

/** The first column of every month grid, with 'auto' already resolved against the language. */
export function useWeekStart(): WeekStart {
  const { i18n } = useTranslation();
  const { weekStartsOn } = usePreferences();
  return resolveWeekStart(weekStartsOn, i18n.language);
}
