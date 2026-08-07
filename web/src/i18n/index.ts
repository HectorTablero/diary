import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { useEffect, useSyncExternalStore } from 'react';
import { initReactI18next } from 'react-i18next';
import { isNative } from '@/lib/native';
import { useOnline } from '@/lib/online';

/**
 * Every shipped language, in the order the picker offers them, labelled with its own endonym —
 * someone looking for their language reads it in that language, not in the current one.
 *
 * This is the single source of truth: `resources`, `supportedLngs` and the Settings picker are all
 * derived from it, so adding a locale means adding one line plus the JSON file (and an entry in
 * translation-context.json, which scripts/checkI18n.ts enforces, and a flag in ./flags, which is
 * picked up by filename and simply absent from the picker if you forget).
 *
 * `zh` is Simplified. With `nonExplicitSupportedLngs` a browser reporting zh-CN, zh-SG or even
 * zh-TW resolves here; a separate `zh-Hant` could be added later without touching anything else.
 */
export const LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

/** The shipped locale a possibly-regional tag ("zh-CN", "it-CH") belongs to. */
export function resolveLanguage(lng: string | undefined): LanguageCode {
  const base = (lng ?? '').toLowerCase().split('-')[0];
  return LANGUAGES.find((l) => l.code === base)?.code ?? 'es';
}

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
    fallbackLng: 'en',
    supportedLngs: LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    // Silences i18next's "made possible by Locize" console advert on every boot.
    showSupportNotice: false,
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

   What does answer it exactly is trying. Offline, a precached file comes back from the service
   worker with no network involved and an absent one rejects, so the probe below is decisive and
   costs nothing but a cache read. This is only safe because the loader is `fetch`-based: probing
   with `import()` would have cached its own failures into the module map and made every language
   it found missing permanently unloadable for the rest of the session — a probe that broke what
   it measured. It runs only while offline, where the answer actually varies:

     - online, or the native build (whose locale files all ship inside the APK) — everything is
       offered, and a switch that fails anyway is reported by the caller, as it must be regardless;
     - offline — each absent language is probed once, and only a probe that *failed* greys one out.

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

/* A refusal only ever meant "not on the device *then*". Once there is a network again the service
   worker can precache the chunk, so the verdicts have to expire — otherwise a language greyed out
   during one flight stays greyed out for the rest of the session. */
window.addEventListener('online', () => {
  if (refused.size === 0) return;
  refused.clear();
  bumpProbeVersion();
});

/**
 * A predicate for "could this device switch to that language right now", which re-renders its
 * caller whenever the answer changes — the network returning, or a probe settling.
 *
 * Only decides what to *offer*. Whether a switch actually worked is the caller's to report: even
 * an offered language can fail to download, on a network that reaches the router and nothing else.
 */
export function useLanguageAvailability(): (code: LanguageCode) => boolean {
  const online = useOnline();
  useSyncExternalStore(
    subscribeProbes,
    () => probeVersion,
    () => probeVersion,
  );

  useEffect(() => {
    if (online || isNative) return;
    for (const { code } of LANGUAGES) void probeLanguage(code);
  }, [online]);

  // Unprobed and in-flight both read as available, so the list never flickers a language out from
  // under the user's cursor on the way to deciding it was fine.
  return (code) =>
    i18n.hasResourceBundle(code, 'translation') || isNative || online || !refused.has(code);
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

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
