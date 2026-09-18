import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Guards the one promise the plugin system makes that nothing else can check: that a user who
 * enables no plugins pays nothing for the ones that exist.
 *
 * Every rule here has already been broken once during development, each time silently and each time
 * invisible from inside the app — which is why this reads real build output rather than source:
 *
 *   1. Plugin code in the entry chunk. A stray static import is all it takes, and the app behaves
 *      identically either way.
 *   2. Plugin locales precached. Vite inlined them as base64 data URIs into the *day page* chunk
 *      (they are a few hundred bytes, under assetsInlineLimit), so every user with a diary
 *      downloaded every plugin's strings in all five languages. `dist` looked empty of them, which
 *      read as success.
 *   3. Plugin locales colliding with the core ones. Emitted as files but into `assets/`, they take
 *      the same `en-<hash>.json` shape the core locales must keep — so no globIgnores pattern can
 *      separate them and they get precached anyway.
 *   4. Core locales *not* precached. The mirror-image mistake: over-broad exclusion, and the app
 *      comes up offline with no strings at all.
 *   5. A plugin's heavy library precached anyway. Being in a plugin's chunk is not enough on its own:
 *      the service worker precaches every script, stylesheet and font it can see, so the notebook's
 *      KaTeX and Mermaid (~900 kB compressed between them) would be downloaded by every visitor.
 *      They have to stay in on-demand chunks, and those — with KaTeX's fonts — out of the precache.
 *
 * Run after a build: `npm run check:bundle -w web`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const WEB = join(here, '..');
const DIST = join(WEB, 'dist');
const ASSETS = join(DIST, 'assets');
const PLUGIN_LOCALES = join(ASSETS, 'plugin-locales');
const PLUGINS_SRC = join(WEB, 'src', 'plugins');

/**
 * The entry chunk's size budget — a coarse backstop, not the real guard.
 *
 * The marker-string check below is what actually catches plugin code leaking into the entry chunk.
 * This is here for the case a marker can't catch: a plugin's *dependency* being hoisted eagerly,
 * which adds kilobytes without adding any of the plugin's own strings.
 *
 * Deliberately loose, because the number is noisier than it looks. Rolldown decides for itself when
 * to hoist shared app code into a separate chunk, and adding one import edge anywhere can move
 * 40 kB out of the entry and into a `shared-*.js` that is still loaded eagerly — this figure went
 * 120 → 79 → 122 kB across three builds during the plugin work, with total JS unchanged throughout.
 * A tight budget here would fail on chunking noise and teach everyone to raise it, which is worse
 * than no budget at all.
 */
const ENTRY_BUDGET_BYTES = 160 * 1024;

const problems: string[] = [];

const exists = (path: string): boolean => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

if (!exists(DIST)) {
  console.error('checkBundle: no dist/ — run `npm run build -w web` first.');
  process.exit(1);
}

const assetNames = readdirSync(ASSETS);
const entryName = assetNames.find((name) => /^index-.*\.js$/.test(name));
if (!entryName) throw new Error('checkBundle: no entry chunk in dist/assets');
const entry = readFileSync(join(ASSETS, entryName), 'utf8');

const pluginIds = exists(PLUGINS_SRC)
  ? readdirSync(PLUGINS_SRC).filter((name) => exists(join(PLUGINS_SRC, name, 'locales')))
  : [];

// --- 1. no plugin code in the entry chunk -------------------------------------------------------

/* Detected by a marker string per plugin rather than by module id, because the bundle carries no
   module ids to search. The marker is something only the plugin's *own* modules contain — its
   translated strings are ideal, since the manifest in registry.ts holds the id but never a string
   from inside the plugin. */
for (const id of pluginIds) {
  const en = JSON.parse(
    readFileSync(join(PLUGINS_SRC, id, 'locales', 'en.json'), 'utf8'),
  ) as Record<string, unknown>;
  const marker = typeof en.title === 'string' ? en.title : undefined;
  if (!marker) continue;
  if (entry.includes(`"${marker}"`) || entry.includes(`\`${marker}\``)) {
    problems.push(`entry chunk contains a string from plugin "${id}" — is it statically imported?`);
  }
}

const entryBytes = statSync(join(ASSETS, entryName)).size;
if (entryBytes > ENTRY_BUDGET_BYTES) {
  problems.push(
    `entry chunk is ${(entryBytes / 1024).toFixed(1)} kB, over the ${ENTRY_BUDGET_BYTES / 1024} kB budget`,
  );
}

// --- 2/3. plugin locales are files, in their own directory --------------------------------------

if (pluginIds.length) {
  if (!exists(PLUGIN_LOCALES)) {
    problems.push(
      'no dist/assets/plugin-locales/ — plugin locales were inlined or misrouted, which silently ' +
        'ships them to every user (see assetsInlineLimit and assetFileNames in vite.config.ts)',
    );
  } else {
    const emitted = readdirSync(PLUGIN_LOCALES);
    if (emitted.length < pluginIds.length * 5) {
      problems.push(
        `dist/assets/plugin-locales/ has ${emitted.length} files, expected at least ` +
          `${pluginIds.length * 5} (5 languages × ${pluginIds.length} plugin(s))`,
      );
    }
  }

  // A data URI is how an inlined asset shows up. Any JSON one is a locale that got folded into JS.
  for (const name of assetNames.filter((file) => file.endsWith('.js'))) {
    if (readFileSync(join(ASSETS, name), 'utf8').includes('data:application/json;base64')) {
      problems.push(`${name} inlines a JSON asset as a data URI — see assetsInlineLimit`);
    }
  }
}

// --- 4. the precache manifest holds core locales and no plugin ones -----------------------------

const swPath = join(DIST, 'sw.js');
if (!exists(swPath)) {
  problems.push('no dist/sw.js — the PWA plugin did not run, so precaching is unverifiable');
} else {
  const sw = readFileSync(swPath, 'utf8');

  /* Core locales must be precached: they are fetched by URL rather than imported, so without them
     in the shell cache the app comes up offline with no strings at all — a louder failure than the
     bundle size that change was fixing. */
  for (const name of assetNames.filter((file) => /^[a-z]{2}-.*\.json$/.test(file))) {
    if (!sw.includes(name)) problems.push(`core locale ${name} is missing from the precache`);
  }

  /* Plugin locales must not be: they are needed only by whoever enables that plugin, and precaching
     them charges every visitor for every plugin that has ever shipped. They are runtime-cached
     instead — offline-durable from first use, free until then. */
  if (exists(PLUGIN_LOCALES)) {
    for (const name of readdirSync(PLUGIN_LOCALES)) {
      if (sw.includes(name)) problems.push(`plugin locale ${name} is in the precache`);
    }
    if (!sw.includes('plugin-locales')) {
      problems.push('no runtime-caching rule for plugin-locales — they would not work offline');
    }
  }
}

// --- 5. the notebook's heavy renderers are fetched on use, never precached ----------------------

/* KaTeX and Mermaid are reached only through the notebook's `import('./renderMath')` and
   `import('./renderDiagram')`, and vite.config.ts (`onDemandChunks`) keeps every file only those
   reach out of the precache. Which files those are is the bundler's business — Mermaid alone is some
   thirty chunks — so this doesn't look for names: it finds each library by a string only its own code
   contains, and checks that no file carrying one is precached. Were the renderers pulled into an
   eager chunk, or the graph walk to stop matching them, that chunk would be precached and fail here. */
const LIBRARY_MARKERS: [string, string][] = [
  ['KaTeX', 'KaTeX parse error'],
  ['Mermaid', 'No diagram type detected matching given configuration'],
];
const sw = exists(swPath) ? readFileSync(swPath, 'utf8') : '';
const scripts = assetNames.filter((file) => file.endsWith('.js'));
for (const [library, marker] of LIBRARY_MARKERS) {
  const carriers = scripts.filter((name) =>
    readFileSync(join(ASSETS, name), 'utf8').includes(marker),
  );
  if (!carriers.length) {
    problems.push(
      `no chunk contains ${library} — its marker string may have changed; update this check`,
    );
  }
  for (const name of carriers) {
    if (sw.includes(name)) {
      problems.push(
        `${name} contains ${library} and is in the precache — every visitor would download it`,
      );
    }
  }
}

/* woff2 only: the other two formats are never requested by anything the app supports, and would
   ship ~800 kB of dead fonts in every APK (see katexWoff2Only in vite.config.ts). */
for (const name of assetNames.filter((file) => /^KaTeX_.*\.(?:woff|ttf)$/.test(file))) {
  problems.push(`${name} was emitted — KaTeX's stylesheet should reference woff2 alone`);
}

if (sw) {
  /* The fonts are found through KaTeX's stylesheet, a step removed from the chunk graph — checked by
     name, since a miss there would be ~290 kB of precache that nothing else would notice. */
  for (const name of assetNames.filter((file) => /^KaTeX_/.test(file))) {
    if (sw.includes(name)) problems.push(`KaTeX font ${name} is in the precache`);
  }
  if (!sw.includes('on-demand')) {
    problems.push(
      'no runtime-caching rule for on-demand files — formulas and diagrams would not work offline',
    );
  }
}

if (problems.length) {
  console.error(`bundle check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

console.log(
  `bundle ok — entry ${(entryBytes / 1024).toFixed(1)} kB (budget ${ENTRY_BUDGET_BYTES / 1024} kB), ` +
    `${pluginIds.length} plugin(s) fully out of it, locales external and unprecached, ` +
    'KaTeX and Mermaid on demand and unprecached.',
);
