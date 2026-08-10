import i18n, { LANGUAGES, resolveLanguage, type LanguageCode } from '@/i18n';

/**
 * Per-plugin translations: separate files, one namespace.
 *
 * ## Separate files
 *
 * A plugin's strings live in `plugins/<id>/locales/<lang>.json` and are fetched only once that
 * plugin is enabled. Folding them into the app's own locale files would mean every user downloading
 * every plugin's strings in their language, forever, whether or not they use any — the same cost
 * the core locales were split out of the main bundle to avoid.
 *
 * Globbed for URLs only (`?url`, eager), so what the entry chunk carries is five short strings per
 * plugin, not the JSON. Fetched with `fetch` and deliberately not `import()`: per the HTML spec a
 * failed dynamic import is remembered in the module map and every later attempt resolves to that
 * cached failure without touching the network, so one attempt in a tunnel would poison a language
 * for the rest of the session. The reasoning is spelled out at length in i18n/index.ts.
 *
 * ## One namespace
 *
 * The strings are merged into the default `translation` namespace under a `plugins.<id>.` prefix,
 * *not* registered as an i18next namespace. An i18next namespace would be invisible to
 * `scripts/checkI18n.ts`: its extractor captures the key with `[\w.]+`, and a colon is outside that
 * class, so a namespaced lookup fails the pattern outright and the key is never checked in any
 * language — silently, and exactly for the strings least likely to be noticed missing. A key prefix
 * keeps lazy loading *and* keeps every key visible to the checker.
 *
 * ## All languages, not just the active one
 *
 * Enabling a plugin loads its strings for the active language first (that one must succeed) and
 * then quietly fetches the rest, so switching language later works offline — matching the core
 * locales, which the service worker precaches in all five. Plugin locales are deliberately *not*
 * precached (see the assetFileNames/globIgnores pair in vite.config.ts), so this background pass is
 * what gets them onto the device at all.
 */

const LOCALE_URLS = import.meta.glob<string>('./*/locales/*.json', {
  eager: true,
  query: '?url',
  import: 'default',
});

const localeUrl = (pluginId: string, code: LanguageCode): string | undefined =>
  LOCALE_URLS[`./${pluginId}/locales/${code}.json`];

/** i18next resource key for a plugin's strings. Nested so a `plugins.habits.title` lookup
    resolves — note the shape is built here, not written out at each call site. */
const bundleFor = (pluginId: string, strings: Record<string, unknown>) => ({
  plugins: { [pluginId]: strings },
});

const loaded = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

const key = (pluginId: string, code: LanguageCode) => `${pluginId}:${code}`;

async function fetchLocale(pluginId: string, code: LanguageCode): Promise<void> {
  const url = localeUrl(pluginId, code);
  if (!url) throw new Error(`plugins: no ${code} locale for "${pluginId}"`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`plugins: ${pluginId}/${code} returned HTTP ${res.status}`);
  const strings = (await res.json()) as Record<string, unknown>;
  // deep = true, overwrite = true: merges under the existing translation bundle rather than
  // replacing it, which is what lets many plugins share the `plugins.*` prefix.
  i18n.addResourceBundle(code, 'translation', bundleFor(pluginId, strings), true, true);
  loaded.add(key(pluginId, code));
}

/**
 * Load one plugin's strings for one language.
 *
 * Coalesces concurrent calls, and — the load-bearing part — drops the entry whether the fetch
 * succeeded or failed. Keeping a rejected promise here would rebuild by hand the module-map
 * behaviour that made `import()` unusable for this: a first failure inherited by every later
 * attempt without ever going near the network.
 */
export function ensurePluginLocale(pluginId: string, lng: string): Promise<void> {
  const code = resolveLanguage(lng);
  const id = key(pluginId, code);
  if (loaded.has(id)) return Promise.resolve();
  const existing = inFlight.get(id);
  if (existing) return existing;
  const load = fetchLocale(pluginId, code).finally(() => inFlight.delete(id));
  inFlight.set(id, load);
  return load;
}

/**
 * Load the active language now, then the rest in the background.
 *
 * Only the active language is awaited, because it is the only one whose absence is visible — the
 * others are an offline convenience and a failed one simply leaves that language to be fetched when
 * it is picked. Rejections from the background pass are swallowed for that reason; the active one
 * is not, so a caller can report a plugin that came up with no strings.
 */
export async function ensurePluginLocales(pluginId: string): Promise<void> {
  await ensurePluginLocale(pluginId, i18n.language);
  for (const { code } of LANGUAGES) {
    if (code === resolveLanguage(i18n.language)) continue;
    void ensurePluginLocale(pluginId, code).catch(() => {});
  }
}

/** Test seam: forget what has been loaded so a fresh fetch is observable. */
export function resetPluginLocales(): void {
  loaded.clear();
  inFlight.clear();
}
