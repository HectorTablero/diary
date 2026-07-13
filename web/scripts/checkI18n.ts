import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Guards the two things that keep going wrong with translations:
 *   1. a t('some.key') that no locale defines (renders as the raw key in the UI), and
 *   2. a key present in one locale but not the other (silently falls back to the other language).
 *
 * Run with `npm run check:i18n -w web`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const LOCALES = join(SRC, 'i18n', 'locales');

type Json = { [key: string]: Json | string | string[] };

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const flatten = (obj: Json, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? flatten(value as Json, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

const readLocale = (lang: string): Set<string> =>
  new Set(flatten(JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8')) as Json));

const locales = { en: readLocale('en'), es: readLocale('es') };

/** i18next resolves `key` through `key_one` / `key_other` / `key_many` … for counted strings. */
const defines = (keys: Set<string>, key: string): boolean =>
  keys.has(key) || [...keys].some((k) => k.startsWith(`${key}_`));

/** Keys referenced from code. Dynamic ones (`t(err.code)`, `t(\`importance.${n}\`)`) can't be seen
    here, which is why this only reports keys that are *used but undefined*, never the reverse. */
const used = new Map<string, string>();
for (const file of walk(SRC)) {
  if (!/\.tsx?$/.test(file) || file.endsWith('.test.ts')) continue;
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(SRC.length + 1).replace(/\\/g, '/');
  const patterns = [
    /\bt\(\s*['"]([\w.]+)['"]/g, // t('a.b')
    /i18nKey=\s*['"]([\w.]+)['"]/g, // <Trans i18nKey="a.b" />
    /\bpickTemplate\(\s*['"]([\w.]+)['"]/g, // notification body template lists
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) used.set(match[1], rel);
  }
}

const problems: string[] = [];

for (const [key, file] of used) {
  for (const [lang, keys] of Object.entries(locales)) {
    if (!defines(keys, key)) problems.push(`missing in ${lang}.json: ${key}  (used in ${file})`);
  }
}

/* Cross-locale parity is compared on *base* keys, with the plural suffix stripped. Languages
   genuinely differ in which plural categories they have — Spanish's CLDR set includes `many`
   (millions) while English's is just one/other — so `sync.offlinePending_many` existing only in
   es.json is correct, not a gap. Comparing raw keys would flag it forever. */
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;
const baseKeys = (keys: Set<string>) => new Set([...keys].map((k) => k.replace(PLURAL_SUFFIX, '')));

const enBase = baseKeys(locales.en);
const esBase = baseKeys(locales.es);
for (const key of enBase) {
  if (!esBase.has(key)) problems.push(`in en.json but not es.json: ${key}`);
}
for (const key of esBase) {
  if (!enBase.has(key)) problems.push(`in es.json but not en.json: ${key}`);
}

if (problems.length) {
  console.error(`i18n check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

console.log(`i18n ok — ${used.size} keys referenced, en/es in sync.`);
