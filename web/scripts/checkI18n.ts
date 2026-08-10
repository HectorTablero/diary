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
const PLUGINS = join(SRC, 'plugins');
const REFERENCE = 'en';

/* --- Plugins ------------------------------------------------------------------------------------

   A plugin keeps its strings in its own `locales/` directory, fetched only when the plugin is
   enabled, so they are absent from the app's locale files by design. Checking them against those
   files would report every plugin key as missing.

   So the checks below run over *key universes*, one per source root: `core`, plus one per plugin.
   Each universe brings its own locale files and its own translation-context.json, and is held to
   exactly the same four rules. Only rule 1 crosses a boundary, in one direction: a key used inside
   a plugin may resolve against that plugin *or* against core, because plugins legitimately reuse
   shared strings like `common.save`. Core code may not reach into a plugin.

   Plugin strings are merged into the app bundle under a `plugins.<id>.` prefix rather than being
   registered as an i18next namespace — see plugins/i18n.ts. That prefix is stripped here so a
   plugin's files can be written (and translated) without repeating it on every line. */
const PLUGIN_KEY_PREFIX = (pluginId: string) => `plugins.${pluginId}.`;

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

const localeLanguages = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name !== 'translation-context.json')
    .map((name) => name.slice(0, -'.json'.length))
    .sort((a, b) => (a === REFERENCE ? -1 : b === REFERENCE ? 1 : a.localeCompare(b)));

const languages = localeLanguages(LOCALES);

type Locales = Record<string, Record<string, string | string[]>>;

const readLocales = (dir: string, prefix: string): Locales =>
  Object.fromEntries(
    languages.map((lang) => [
      lang,
      flatten(JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8')) as Json, prefix),
    ]),
  );

/** One set of strings held to the four rules: the app's own, or one plugin's. */
interface Universe {
  /** How it is named in a failure message. */
  label: string;
  /** `src`-relative directory whose code resolves against it. Empty for core, which is everywhere. */
  scope: string;
  contextFile: string;
  /** Namespace the context file must document. For a plugin, its id. */
  requiredNamespaces: string[];
  locales: Locales;
}

const problems: string[] = [];

const pluginIds = (() => {
  try {
    return readdirSync(PLUGINS).filter((name) => {
      try {
        return statSync(join(PLUGINS, name, 'locales')).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return []; // no plugins directory yet
  }
})();

const core: Universe = {
  label: 'core',
  scope: '',
  contextFile: CONTEXT_FILE,
  requiredNamespaces: [],
  locales: readLocales(LOCALES, ''),
};

if (!core.locales[REFERENCE]) throw new Error(`missing reference locale ${REFERENCE}.json`);

const pluginUniverses: Universe[] = pluginIds.flatMap((id) => {
  const dir = join(PLUGINS, id, 'locales');
  /* A plugin's language set must match core's exactly. Without this, adding `de.json` to the app
     would leave every plugin silently short a language — and the failure would only appear as
     English text on a German screen, in the one place nobody is looking. */
  const found = localeLanguages(dir);
  const missing = languages.filter((lang) => !found.includes(lang));
  const extra = found.filter((lang) => !languages.includes(lang));
  if (missing.length) problems.push(`plugin "${id}": no locale file for ${missing.join(', ')}`);
  if (extra.length) problems.push(`plugin "${id}": has ${extra.join(', ')} but the app does not`);
  if (missing.length) return [];

  return [
    {
      label: `plugin "${id}"`,
      scope: `plugins/${id}`,
      // Beside `locales/`, not inside it — mirroring core, and keeping the globbed directory to
      // language files only. A stray .json in there is bundled as an asset by plugins/i18n.ts.
      contextFile: join(PLUGINS, id, 'translation-context.json'),
      requiredNamespaces: [id],
      // Prefixed to match what plugins/i18n.ts merges into the bundle, so the keys checked here are
      // the keys written in code.
      locales: readLocales(dir, PLUGIN_KEY_PREFIX(id)),
    },
  ];
});

const universes = [core, ...pluginUniverses];

/* Cross-locale parity is compared on *base* keys, with the plural suffix stripped. Languages
   genuinely differ in which plural categories they have — Spanish and Italian include `many`
   (millions) where English has only one/other, and Japanese and Chinese have only `other`, so a
   single unsuffixed key covers every count. Comparing raw keys would flag all of that forever. */
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;
const stripPlural = (key: string) => key.replace(PLURAL_SUFFIX, '');
const baseKeys = (keys: Iterable<string>) => new Set([...keys].map(stripPlural));

/**
 * Checks whether a referenced translation key exists.
 *
 * For normal keys, this also accepts i18next plural variants:
 *   "foo" -> "foo", "foo_one", "foo_other", ...
 *
 * For array entries, references such as:
 *   "onboarding.demo.otherTags.3"
 * resolve against the array stored at:
 *   "onboarding.demo.otherTags"
 *
 * The requested index must exist in every locale.
 */
const defines = (locale: Record<string, string | string[]>, key: string): boolean => {
  // Normal key / plural variant.
  const keys = Object.keys(locale);
  for (const candidate of keys) {
    if (candidate === key || candidate.startsWith(`${key}_`)) return true;
  }

  // Array item reference: e.g. "otherTags.3"
  const match = key.match(/^(.*)\.(\d+)$/);
  if (!match) return false;

  const [, parentKey, indexString] = match;
  const index = Number(indexString);
  const value = locale[parentKey];

  return Array.isArray(value) && index >= 0 && index < value.length;
};

// --- 1. keys referenced from code exist in every locale ---------------------------------------

/* Dynamic keys (`t(err.code)`, `t(\`importance.${n}\`)`) can't be seen here, which is why this
   only reports keys that are *used but undefined*, never the reverse.

   A Set of files per key, not one file: a key used in both core and a plugin has two homes, and
   keeping only the last one seen would make the universe a key is checked against depend on the
   order the directory happened to be walked. */
const used = new Map<string, Set<string>>();
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
    for (const match of text.matchAll(pattern)) {
      const files = used.get(match[1]) ?? new Set<string>();
      files.add(rel);
      used.set(match[1], files);
    }
  }
}

/** The plugin universe a source file belongs to, if any. Core code has none. */
const universeFor = (rel: string): Universe | undefined =>
  pluginUniverses.find((universe) => rel.startsWith(`${universe.scope}/`));

for (const [key, files] of used) {
  for (const file of files) {
    /* Resolvable against this file's own plugin *or* against core — plugins reuse shared strings
       like `common.save`, and there is no way to tell from the call site which was meant. Core code
       gets core only: a plugin's strings are not loaded unless that plugin is enabled, so a core
       file referencing one would render a raw key for everyone who hasn't turned it on. */
    const own = universeFor(file);
    const where = own ? `${own.label} or core` : 'core';
    for (const lang of languages) {
      const found =
        defines(core.locales[lang], key) || (own ? defines(own.locales[lang], key) : false);
      if (!found) problems.push(`missing from ${where} (${lang}): ${key}  (used in ${file})`);
    }
  }
}

/* Rules 2, 3 and 4 are per-universe: each set of strings is internally consistent, documented by
   its own context file, and answerable for its own languages. Nothing crosses between them. */

const varsIn = (value: string | string[]): Set<string> => {
  const found = new Set<string>();
  for (const text of Array.isArray(value) ? value : [value]) {
    for (const match of text.matchAll(/\{\{(\w+)}}/g)) found.add(match[1]);
  }
  return found;
};

interface ContextFile {
  namespaces?: Record<string, { where?: string; keys?: Record<string, unknown> }>;
  languageNotes?: Record<string, unknown>;
}

function checkUniverse(universe: Universe): void {
  const { label, locales } = universe;
  const at = (lang: string) => (universe === core ? `${lang}.json` : `${label} ${lang}.json`);

  // --- 2. every locale covers exactly the reference's keys -------------------------------------

  const referenceBase = baseKeys(Object.keys(locales[REFERENCE]));
  for (const lang of languages) {
    if (lang === REFERENCE) continue;
    const langBase = baseKeys(Object.keys(locales[lang]));
    for (const key of referenceBase) {
      if (!langBase.has(key)) problems.push(`in ${at(REFERENCE)} but not ${at(lang)}: ${key}`);
    }
    for (const key of langBase) {
      if (!referenceBase.has(key)) problems.push(`in ${at(lang)} but not ${at(REFERENCE)}: ${key}`);
    }
  }

  // --- 3. interpolation variables line up with the reference -----------------------------------

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
      for (const [itemLabel, text] of items) {
        const vars = varsIn(text);
        for (const name of reference.required) {
          if (!vars.has(name)) problems.push(`${at(lang)} ${itemLabel}: missing {{${name}}}`);
        }
        for (const name of vars) {
          if (!reference.allowed.has(name))
            problems.push(`${at(lang)} ${itemLabel}: unknown {{${name}}}`);
        }
      }
    }
  }

  // --- 4. the translation context file stays in step with the strings --------------------------

  /* The context file is what anyone adding a language reads before writing a word. If a namespace
     can appear in the UI without a note explaining where it shows up, the file has started to rot,
     so this fails the build the same way a missing key does.

     A plugin brings its own, for the same reason it brings its own strings: whoever translates it
     is looking at one folder, and a note in the app's file two directories away is a note they will
     not read. `requiredNamespaces` is how a plugin's is held to naming the plugin itself — its keys
     are flat (`title`, `empty`), so there is no namespace segment to derive one from. */
  const context = JSON.parse(readFileSync(universe.contextFile, 'utf8')) as ContextFile;
  const documented = context.namespaces ?? {};
  const where =
    universe === core ? 'translation-context.json' : `${label} translation-context.json`;

  // A plugin's own id, or — for core — every top-level segment its keys actually use.
  const expected = universe.requiredNamespaces.length
    ? new Set(universe.requiredNamespaces)
    : new Set([...referenceBase].map((key) => key.split('.')[0]));

  for (const namespace of expected) {
    const entry = documented[namespace];
    if (!entry) problems.push(`${where}: no entry for namespace "${namespace}"`);
    else if (!entry.where?.trim()) {
      problems.push(`${where}: "${namespace}" needs a non-empty "where"`);
    }
  }
  for (const namespace of Object.keys(documented)) {
    if (!expected.has(namespace)) {
      problems.push(`${where}: "${namespace}" is documented but no longer exists`);
    }
  }

  // Flavour-text lists are the strings most likely to be mistranslated literally, so each one must
  // carry its own note rather than relying on the namespace's.
  for (const [key, value] of Object.entries(locales[REFERENCE])) {
    if (!Array.isArray(value)) continue;
    const [namespace, ...rest] = key.split('.');
    const noteKey = universe.requiredNamespaces.length
      ? // Plugin keys were prefixed to match the merged bundle; the context file documents them
        // as they are written in the locale file, unprefixed.
        key.split('.').slice(2).join('.')
      : rest.join('.');
    const noteNamespace = universe.requiredNamespaces[0] ?? namespace;
    if (!documented[noteNamespace]?.keys?.[noteKey]) {
      problems.push(`${where}: flavour-text list "${key}" needs a note`);
    }
  }

  for (const lang of languages) {
    if (!context.languageNotes?.[lang]) {
      problems.push(`${where}: no languageNotes entry for "${lang}"`);
    }
  }
}

for (const universe of universes) checkUniverse(universe);

if (problems.length) {
  console.error(`i18n check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const stringCount = universes.reduce(
  (total, universe) => total + baseKeys(Object.keys(universe.locales[REFERENCE])).size,
  0,
);

console.log(
  `i18n ok — ${used.size} keys referenced, ${stringCount} strings × ${languages.length} languages ` +
    `(${languages.join(', ')}) in sync across ${universes.length} bundle(s)` +
    `${pluginUniverses.length ? `: core + ${pluginUniverses.map((u) => u.scope).join(', ')}` : ''}.`,
);
