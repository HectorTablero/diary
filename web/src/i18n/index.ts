import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { useEffect, useSyncExternalStore } from 'react';
import { initReactI18next } from 'react-i18next';
import { onReconnected } from '@/db/sync';
import { useSyncStatus } from '@/db/useSyncStatus';
import { isNative } from '@/lib/native';
import { useOnline } from '@/lib/online';
import { canFetchLocales } from './availability';

/* The language table lives in ./languages, which has no side effects. Imported for use below and
   re-exported so every existing `from '@/i18n'` import keeps working — and so that wanting the
   table no longer means booting i18next and registering window listeners to get it. */
import { DEFAULT_LANGUAGE, LANGUAGES, resolveLanguage, type LanguageCode } from './languages';

export { DEFAULT_LANGUAGE, LANGUAGES, resolveLanguage, type LanguageCode };

/**
 * One file per language, requested only when it is the one being used.
 *
 * All five used to be static imports, which put every string of every language — around 150 kB of
 * JSON — into the main bundle, so each user downloaded four translations they will never read.
 * Only the hashed URLs are eager here; the bytes still arrive on demand.
 *
 * `?url` + `fetch`, and specifically *not* `import()`, which is what this was first written as.
 * A dynamic import that fails to fetch is not a transient error: per the HTML spec the module
 * map records the failure and every later `import()` of the same specifier resolves to that
 * cached failure without going near the network. On an offline-first app that is precisely the
 * wrong semantics — one attempt made in a tunnel would poison that language until the page was
 * reloaded, so "try again once you're connected" could never work, and no request would even
 * appear in devtools to explain why. `fetch` has no such memory: a retry actually retries.
 *
 * Globbed rather than written out one per line, which the `import()` version had to be so the
 * bundler could see a literal path in each call. Nothing here needs a chunk emitted, only a URL,
 * so adding a language really is just dropping the JSON file in.
 */
const LOCALE_URLS = import.meta.glob<string>('./locales/*.json', {
  eager: true,
  query: '?url',
  import: 'default',
});

const localeUrl = (code: LanguageCode): string | undefined => LOCALE_URLS[`./locales/${code}.json`];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    /* Empty: `ensureLanguage` fills in the detected one before the app renders (see main.tsx).
       `fallbackLng` therefore points at a bundle that may not be loaded — which is safe only
       because scripts/checkI18n.ts fails the build if any locale is missing a key the others
       have, so the fallback has nothing left to resolve. If that check is ever dropped, this
       needs to preload 'en' too. */
    resources: {},
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    // (i18next 26 removed the "made possible by Locize" boot advert, and `showSupportNotice`
    //  along with it. Nothing to silence any more.)
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'lang',
    },
  });

async function loadLanguage(code: LanguageCode): Promise<void> {
  const url = localeUrl(code);
  if (!url) throw new Error(`i18n: no locale file for "${code}"`);
  // Offline with a service worker, this is answered from the precache; offline without one, it
  // rejects. Either way nothing is remembered, so the next attempt is a real attempt.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`i18n: ${code} returned HTTP ${res.status}`);
  const strings = (await res.json()) as Record<string, unknown>;
  i18n.addResourceBundle(code, 'translation', strings, true, true);
}

/* Coalesces a load already in progress, so the offline probe and a user picking that same language
   a moment later share one request instead of racing.

   The `finally` is the load-bearing line: the entry is dropped whether the load succeeded or
   failed. Keeping a *rejected* promise here would rebuild, by hand, exactly the module-map
   behaviour that made `import()` unusable for this — a first failure that every later attempt
   inherits without ever touching the network. Successes need no entry either; the bundle is in
   i18next by then and the check below short-circuits. */
const inFlight = new Map<LanguageCode, Promise<void>>();

/** Load a language's strings if they aren't in memory yet. Idempotent and safe to call freely.
    Rejects when the file can't be fetched — callers must say so rather than swallowing it, and
    the rejection is genuinely transient: calling again after the network returns re-requests. */
export function ensureLanguage(lng: string): Promise<void> {
  const code = resolveLanguage(lng);
  if (i18n.hasResourceBundle(code, 'translation')) return Promise.resolve();
  const existing = inFlight.get(code);
  if (existing) return existing;
  const load = loadLanguage(code).finally(() => inFlight.delete(code));
  inFlight.set(code, load);
  return load;
}

/* --- Which languages this device can actually switch to ----------------------------------------

   Loading the locales on demand bought a much smaller bundle and one new failure: a language whose
   file isn't on the device cannot be loaded without a network, and `ensureLanguage` rejects. That
   used to surface nowhere — the picker offered all five whatever the connection was, and choosing
   an absent one on a train left the UI in the old language with no toast, no error, nothing.

   Answering "is it there" honestly is harder than it looks, because usually it *is*: the service
   worker precaches every emitted file, so an installed PWA normally has all five whether or not
   the user ever opened one. Guessing from a record of which languages had been used before would
   have been pessimistic in exactly the wrong direction — greying out a language that would have
   worked. And the Cache API can't usefully be asked either: it would answer for the HTTP cache
   while the service worker holds its own.

   What does answer it exactly is trying. With nothing fetchable, a precached file comes back from
   the service worker with no network involved and an absent one rejects, so the probe below is
   decisive and costs nothing but a cache read. This is only safe because the loader is
   `fetch`-based: probing with `import()` would have cached its own failures into the module map and
   made every language it found missing permanently unloadable for the rest of the session — a probe
   that broke what it measured. It runs only when the strings cannot be downloaded, where the answer
   actually varies:

     - strings are fetchable, or the native build (whose locale files all ship inside the APK) —
       everything is offered, and a switch that fails anyway is reported by the caller, as it must
       be regardless;
     - they are not — each absent language is probed once, and only a probe that *failed* greys one
       out.

   "Cannot be downloaded" is deliberately wider than `navigator.onLine`: a server the sync engine
   cannot reach serves these chunks no better than no network does. See `useLanguageAvailability`.

   Unprobed and in-flight both read as available, so the list never flickers a language out from
   under the user's cursor on the way to deciding it was fine. */

/* Only refusals are recorded. A probe that *succeeds* needs no bookkeeping at all: it went through
   ensureLanguage, so the bundle is in memory and `hasResourceBundle` already answers for it. */
const refused = new Set<LanguageCode>();
let probeVersion = 0;
const probeListeners = new Set<() => void>();

function bumpProbeVersion() {
  probeVersion++;
  probeListeners.forEach((cb) => cb());
}

async function probeLanguage(code: LanguageCode): Promise<void> {
  if (refused.has(code) || i18n.hasResourceBundle(code, 'translation')) return;
  try {
    // ensureLanguage rather than a bare import: a probe that succeeds has already paid for the
    // strings, so keeping them makes the switch the user is probably about to make instant.
    await ensureLanguage(code);
  } catch {
    refused.add(code);
  }
  bumpProbeVersion();
}

const subscribeProbes = (cb: () => void) => {
  probeListeners.add(cb);
  return () => {
    probeListeners.delete(cb);
  };
};

/* A refusal only ever meant "not on the device *then*". Once the strings can be fetched again the
   service worker can precache the chunk, so the verdicts have to expire — otherwise a language
   greyed out during one flight stays greyed out for the rest of the session.

   Two ways back, matching the two ways out: the browser regaining a network, and the server
   answering again after it had stopped. `onReconnected` only fires when a sync had actually
   failed, which is exactly when `unreachable` was the thing greying languages out. */
function forgetRefusals() {
  if (refused.size === 0) return;
  refused.clear();
  bumpProbeVersion();
}

// Guarded for the same reason as the `storage` listener in lib/preferences.ts: this is the only
// statement in the module that assumes a browser, and leaving it bare made *importing* i18n throw
// under the node-environment `logic` project — which lib/dates.ts drags in, and which therefore
// dictated what half the app was allowed to import. onReconnected is environment-agnostic.
if (typeof window !== 'undefined') window.addEventListener('online', forgetRefusals);
onReconnected(forgetRefusals);

/**
 * A predicate for "could this device switch to that language right now", which re-renders its
 * caller whenever the answer changes — the network returning, or a probe settling.
 *
 * Only decides what to *offer*. Whether a switch actually worked is the caller's to report: even
 * an offered language can fail to download, on a network that reaches the router and nothing else.
 */
export function useLanguageAvailability(): (code: LanguageCode) => boolean {
  const online = useOnline();
  const { blocker } = useSyncStatus();
  useSyncExternalStore(
    subscribeProbes,
    () => probeVersion,
    () => probeVersion,
  );

  // Wider than `navigator.onLine`: an unreachable server serves these chunks no better than no
  // network does. The reasoning, and why the other two blockers are not in it, is in ./availability.
  const canFetchStrings = canFetchLocales(online, blocker);

  useEffect(() => {
    if (canFetchStrings || isNative) return;
    for (const { code } of LANGUAGES) void probeLanguage(code);
  }, [canFetchStrings]);

  // Unprobed and in-flight both read as available, so the list never flickers a language out from
  // under the user's cursor on the way to deciding it was fine.
  return (code) =>
    i18n.hasResourceBundle(code, 'translation') ||
    isNative ||
    canFetchStrings ||
    !refused.has(code);
}

/**
 * Switch language, strings first.
 *
 * The load has to finish *before* `changeLanguage`, or i18next would emit `languageChanged`
 * against an empty bundle and every label on screen would flash its raw key for a frame.
 */
export async function changeLanguage(lng: LanguageCode): Promise<void> {
  await ensureLanguage(lng);
  await i18n.changeLanguage(lng);
}

/* --- Following the device ---------------------------------------------------------------------

   The detector's own rule is that a stored `lang` key is an explicit choice and its absence means
   "ask the browser". That is already the behaviour on a first run, but it was previously a state
   the user could leave and never get back to: picking a language wrote the key, and nothing removed
   it, so a phone that later changed its system language kept the diary in whatever had been chosen
   once. These make it a choice you can return to. */

/** i18next's `lookupLocalStorage`, in one place rather than spelled out at each use. */
const LANGUAGE_KEY = 'lang';

/** The language the device would choose on its own, ignoring anything stored. */
export const detectedLanguage = (): LanguageCode => resolveLanguage(navigator.language);

/** Whether the language is currently following the device rather than an explicit choice. */
export function isAutomaticLanguage(): boolean {
  try {
    return !localStorage.getItem(LANGUAGE_KEY);
  } catch {
    // No storage means nothing can have been chosen, which is exactly what automatic means.
    return true;
  }
}

/**
 * Hand language selection back to the device.
 *
 * The key is removed *after* the switch, not before: `caches: ['localStorage']` means
 * `i18n.changeLanguage` writes it back, so clearing first would be undone a line later. Clearing
 * afterwards is also correct when the detected language is the one already active — nothing
 * changes on screen, but the stored override is gone, which is the whole point of the option.
 */
export async function followDeviceLanguage(): Promise<void> {
  await changeLanguage(detectedLanguage());
  try {
    localStorage.removeItem(LANGUAGE_KEY);
  } catch {
    /* nothing was stored to begin with */
  }
}

/* Keeping <html lang> in step with the active language — which is what makes a screen reader
   switch voice, and what `checkI18n` cannot verify because it is not a string.

   Guarded like the `online` listener above: the whole point of this module is to be importable by
   anything, and a bare `document` at module scope meant it was importable only inside a DOM. That
   restriction propagated a long way — lib/dates.ts imports this, so every node-environment test
   whose graph reaches a date helper inherited it. */
if (typeof document !== 'undefined') {
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
  document.documentElement.lang = i18n.language;
}

export default i18n;
