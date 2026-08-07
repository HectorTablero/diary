/*
 * The language table, on its own.
 *
 * Split out of ./index because that module boots i18next and registers window listeners at import
 * time, so anything wanting to know merely *which languages exist* — lib/dates.ts, for one, which
 * only needs resolveLanguage to pick a date-fns locale — was dragging the whole bootstrap along
 * with it, and could not be tested outside a DOM at all.
 *
 * Nothing here has side effects or imports anything.
 */

/**
 * Every shipped language, in the order the picker offers them, labelled with its own endonym —
 * someone looking for their language reads it in that language, not in the current one.
 *
 * This is the single source of truth: `resources`, `supportedLngs` and the Settings picker are all
 * derived from it, so adding a locale means adding one line plus the JSON file (and an entry in
 * translation-context.json, which scripts/checkI18n.ts enforces, and a flag in ./flags, which is
 * picked up by filename and simply absent from the picker if you forget).
 *
 * The label is the only part of this a filename cannot supply, which is why the list is written out
 * here while every other copy of it — checkI18n's, the build-time one in scripts/locales.mjs, the
 * runtime locale URLs — reads the directory instead. `locales.test.ts` holds them all in step.
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

/**
 * The locale to assume when nothing better is known.
 *
 * English, because it is the language the source strings are authored in and therefore the only one
 * checkI18n guarantees defines every key — which is what makes it safe to fall back to a bundle
 * that may not be loaded. The same decision is written down in three other places that cannot
 * import this one: `fallbackLng` in ./index, `REFERENCE` in scripts/checkI18n.ts, and
 * `DEFAULT_LOCALE` in scripts/locales.mjs, which the build stamps into index.html. A test asserts
 * all four agree rather than trusting this comment to be read.
 */
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/** The shipped locale a possibly-regional tag ("zh-CN", "it-CH") belongs to. */
export function resolveLanguage(lng: string | undefined): LanguageCode {
  const base = (lng ?? '').toLowerCase().split('-')[0];
  return LANGUAGES.find((l) => l.code === base)?.code ?? DEFAULT_LANGUAGE;
}
