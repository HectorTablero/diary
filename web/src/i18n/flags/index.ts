import type { LanguageCode } from '../index';

/**
 * The circular flag shown beside each language in the Settings picker, as a ready-to-use
 * `data:` URI. See README.md for provenance and licence.
 *
 * Inlined rather than emitted as five separate asset files. `?raw` + a data URI is a deliberate
 * choice over Vite's `?url`, which only inlines while the files stay under `assetsInlineLimit` —
 * a default that could change under us, and a fallback (separate files, fetched over HTTP) that
 * would be exactly wrong here: these icons decorate the control whose entire job is reporting
 * what works without a network. Inlined, they cannot 404 and do not wait on the service-worker
 * precache. Four kilobytes of SVG, in a chunk only the Settings page pulls in.
 *
 * Globbed rather than listed one import per line, so adding a language really is "drop the file
 * in" — unlike the loaders in ../index.ts, which have to be written out because the bundler needs
 * a literal path in each `import()` to know what chunk to emit.
 */
const RAW_FLAGS = import.meta.glob<string>('./*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/* encodeURIComponent, not base64: it leaves the markup legible in devtools, encodes to fewer bytes
   for text like this, and needs no btoa/Unicode dance. The '#' in every fill would otherwise be
   read as a fragment, which is what makes the encoding mandatory rather than cosmetic. */
const FLAGS: Partial<Record<LanguageCode, string>> = Object.fromEntries(
  Object.entries(RAW_FLAGS).map(([path, svg]) => [
    path.replace(/^\.\/|\.svg$/g, ''),
    `data:image/svg+xml,${encodeURIComponent(svg)}`,
  ]),
);

/** `undefined` for a language with no flag file, which callers render without one. */
export const languageFlag = (code: LanguageCode): string | undefined => FLAGS[code];
