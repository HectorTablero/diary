import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * The shipped locales, read from the directory that defines them.
 *
 * Build-time only — it touches the filesystem, so nothing in src/ may import it. It exists so that
 * the language list is never written down twice: adding `de.json` should be the whole change, the
 * way it already is for checkI18n.ts (which derives its list the same way) and for the runtime
 * locale URLs (an import.meta.glob over the same folder).
 *
 * The one place that could not derive itself was index.html's pre-hydration script, which needs the
 * list before any module loads. Vite injects it there from here instead of repeating it.
 */

const LOCALES_DIR = fileURLToPath(new URL('../src/i18n/locales', import.meta.url));

/** Every locale that has a file, sorted, e.g. ['en', 'es', 'it', 'ja', 'zh']. */
export const localeCodes = () =>
  readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();

/**
 * The locale to assume before anything is known about the reader.
 *
 * Must stay in step with `fallbackLng` in src/i18n and with `REFERENCE` in checkI18n.ts — it is the
 * same decision, and English is the language the source strings are authored in, so it is the one
 * locale guaranteed to define every key. A test asserts the three agree rather than trusting this
 * comment.
 */
export const DEFAULT_LOCALE = 'en';
