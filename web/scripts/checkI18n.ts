import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Guards the things that keep going wrong with translations:
 *   1. a t('some.key') that some locale doesn't define (renders as the raw key in that language),
 *   2. a key present in one locale but not another (silently falls back to another language),
 *   3. a lost or invented {{interpolation}} — a notification body that drops {{name}} still
 *      "works", it just reads as a sentence with a hole in it, which no test would catch, and
 *   4. a namespace or flavour-text list missing from translation-context.json, which is what a
 *      future translator (human or model) reads to know the tone and the UI context.
 *
 * English is the reference: it's the language the source strings are authored in. Locales are
 * discovered from the directory, so adding one needs no change here.
 *
 * Run with `npm run check:i18n -w web`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const LOCALES = join(SRC, 'i18n', 'locales');
const CONTEXT_FILE = join(SRC, 'i18n', 'translation-context.json');
const REFERENCE = 'en';

type Json = { [key: string]: Json | string | string[] };

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** Leaf paths mapped to their value. A string[] (flavour-text list) counts as one leaf. */
const flatten = (obj: Json, prefix = '', out: Record<string, string | string[]> = {}) => {
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}${key}`;
    if (Array.isArray(value)) out[path] = value;
    else if (typeof value === 'object' && value !== null) flatten(value, `${path}.`, out);
    else out[path] = value;
  }
  return out;
};

const languages = readdirSync(LOCALES)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort((a, b) => (a === REFERENCE ? -1 : b === REFERENCE ? 1 : a.localeCompare(b)));

const locales = Object.fromEntries(
  languages.map((lang) => [
    lang,
    flatten(JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8')) as Json),
  ]),
);

if (!locales[REFERENCE]) throw new Error(`missing reference locale ${REFERENCE}.json`);

/* Cross-locale parity is compared on *base* keys, with the plural suffix stripped. Languages
   genuinely differ in which plural categories they have — Spanish and Italian include `many`
   (millions) where English has only one/other, and Japanese and Chinese have only `other`, so a
   single unsuffixed key covers every count. Comparing raw keys would flag all of that forever. */
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;
const stripPlural = (key: string) => key.replace(PLURAL_SUFFIX, '');
const baseKeys = (keys: Iterable<string>) => new Set([...keys].map(stripPlural));

/** i18next resolves `key` through `key_one` / `key_other` / `key_many` … for counted strings. */
const defines = (keys: Iterable<string>, key: string): boolean => {
  for (const candidate of keys)
    if (candidate === key || candidate.startsWith(`${key}_`)) return true;
  return false;
};

const problems: string[] = [];

// --- 1. keys referenced from code exist in every locale ---------------------------------------

/* Dynamic keys (`t(err.code)`, `t(\`importance.${n}\`)`) can't be seen here, which is why this
   only reports keys that are *used but undefined*, never the reverse. */
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

for (const [key, file] of used) {
  for (const lang of languages) {
    if (!defines(Object.keys(locales[lang]), key)) {
      problems.push(`missing in ${lang}.json: ${key}  (used in ${file})`);
    }
  }
}

// --- 2. every locale covers exactly the reference's keys ---------------------------------------

const referenceBase = baseKeys(Object.keys(locales[REFERENCE]));
for (const lang of languages) {
  if (lang === REFERENCE) continue;
  const langBase = baseKeys(Object.keys(locales[lang]));
  for (const key of referenceBase) {
    if (!langBase.has(key)) problems.push(`in ${REFERENCE}.json but not ${lang}.json: ${key}`);
  }
  for (const key of langBase) {
    if (!referenceBase.has(key)) problems.push(`in ${lang}.json but not ${REFERENCE}.json: ${key}`);
  }
}

// --- 3. interpolation variables line up with the reference -------------------------------------

const varsIn = (value: string | string[]): Set<string> => {
  const found = new Set<string>();
  for (const text of Array.isArray(value) ? value : [value]) {
    for (const match of text.matchAll(/\{\{(\w+)}}/g)) found.add(match[1]);
  }
  return found;
};

/* Reference variables are collected across every plural variant of a key, then split into:
   - allowed = the union. Anything outside it is a typo or an invented placeholder.
   - required = the intersection. Only variables present in *all* English variants are mandatory,
     because English sometimes omits one from a variant that doesn't need it ("Ended yesterday"
     has no {{count}}, while "Ended {{count}} days ago" does) — and a language with a single
     plural form has to use the general wording, which does need it. */
const referenceVars = new Map<string, { allowed: Set<string>; required: Set<string> }>();
for (const [key, value] of Object.entries(locales[REFERENCE])) {
  const base = stripPlural(key);
  const vars = varsIn(value);
  const entry = referenceVars.get(base);
  if (!entry) {
    referenceVars.set(base, { allowed: new Set(vars), required: new Set(vars) });
    continue;
  }
  for (const name of vars) entry.allowed.add(name);
  for (const name of [...entry.required]) if (!vars.has(name)) entry.required.delete(name);
}

for (const lang of languages) {
  for (const [key, value] of Object.entries(locales[lang])) {
    const reference = referenceVars.get(stripPlural(key));
    if (!reference) continue; // already reported as an unknown key above
    // Every item of a flavour-text list is checked on its own: one body missing {{name}} is a bug
    // even when its neighbours are fine.
    const items: [string, string][] = Array.isArray(value)
      ? value.map((item, i) => [`${key}[${i}]`, item])
      : [[key, value]];
    for (const [label, text] of items) {
      const vars = varsIn(text);
      for (const name of reference.required) {
        if (!vars.has(name)) problems.push(`${lang}.json ${label}: missing {{${name}}}`);
      }
      for (const name of vars) {
        if (!reference.allowed.has(name))
          problems.push(`${lang}.json ${label}: unknown {{${name}}}`);
      }
    }
  }
}

// --- 4. the translation context file stays in step with the strings ----------------------------

/* The context file is what anyone adding a language reads before writing a word. If a namespace
   can appear in the UI without a note explaining where it shows up, the file has started to rot,
   so this fails the build the same way a missing key does. */
interface ContextFile {
  namespaces?: Record<string, { where?: string; keys?: Record<string, unknown> }>;
  languageNotes?: Record<string, unknown>;
}

const context = JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as ContextFile;
const documented = context.namespaces ?? {};

for (const namespace of new Set([...referenceBase].map((key) => key.split('.')[0]))) {
  const entry = documented[namespace];
  if (!entry) problems.push(`translation-context.json: no entry for namespace "${namespace}"`);
  else if (!entry.where?.trim()) {
    problems.push(`translation-context.json: "${namespace}" needs a non-empty "where"`);
  }
}
for (const namespace of Object.keys(documented)) {
  if (![...referenceBase].some((key) => key.split('.')[0] === namespace)) {
    problems.push(`translation-context.json: "${namespace}" is documented but no longer exists`);
  }
}

// Flavour-text lists are the strings most likely to be mistranslated literally, so each one must
// carry its own note rather than relying on the namespace's.
for (const [key, value] of Object.entries(locales[REFERENCE])) {
  if (!Array.isArray(value)) continue;
  const [namespace, ...rest] = key.split('.');
  if (!documented[namespace]?.keys?.[rest.join('.')]) {
    problems.push(`translation-context.json: flavour-text list "${key}" needs a note`);
  }
}

for (const lang of languages) {
  if (!context.languageNotes?.[lang]) {
    problems.push(`translation-context.json: no languageNotes entry for "${lang}"`);
  }
}

if (problems.length) {
  console.error(`i18n check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

console.log(
  `i18n ok — ${used.size} keys referenced, ${referenceBase.size} strings × ${languages.length} languages (${languages.join(', ')}) in sync.`,
);
