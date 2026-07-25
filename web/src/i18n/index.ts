import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';
import it from './locales/it.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';

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

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      it: { translation: it },
      ja: { translation: ja },
      zh: { translation: zh },
    },
    fallbackLng: 'es',
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

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
