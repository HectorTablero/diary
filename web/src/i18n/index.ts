import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

/**
 * Every shipped language, in the order the picker offers them, labelled with its own endonym —
 * someone looking for their language reads it in that language, not in the current one.
 *
 * This is the single source of truth: `resources`, `supportedLngs` and the Settings picker are all
 * derived from it, so adding a locale means adding one line plus the JSON file (and an entry in
 * translation-context.json, which scripts/checkI18n.ts enforces).
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
 * One chunk per language, fetched only when it is the one being used.
 *
 * All five used to be static imports, which put every string of every language — around 150 kB of
 * JSON — into the main bundle, so each user downloaded four translations they will never read.
 * These are `import()` calls, so Rollup emits five separate chunks and only the active one is
 * ever requested.
 *
 * Written out one per line rather than built from LANGUAGES: the bundler has to see a literal
 * path in each `import()` to statically know what to emit.
 */
const LOADERS: Record<LanguageCode, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./locales/en.json'),
  es: () => import('./locales/es.json'),
  it: () => import('./locales/it.json'),
  ja: () => import('./locales/ja.json'),
  zh: () => import('./locales/zh.json'),
};

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

/** Load a language's strings if they aren't in memory yet. Idempotent and safe to call freely. */
export async function ensureLanguage(lng: string): Promise<void> {
  const code = resolveLanguage(lng);
  if (i18n.hasResourceBundle(code, 'translation')) return;
  const { default: strings } = await LOADERS[code]();
  i18n.addResourceBundle(code, 'translation', strings, true, true);
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
