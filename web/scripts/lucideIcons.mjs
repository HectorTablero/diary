import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * Every Lucide icon as *data*, served to the bundle as `virtual:lucide-icons`.
 *
 * Build-time only — it touches the filesystem, so nothing in src/ may import it. It is what lets the
 * icon picker offer the whole set without either of the two obvious routes, each of which is wrong
 * here for a reason the build would never report:
 *
 *   - `import { icons } from 'lucide-react'` is ~700 kB of React components, and `manualChunks`
 *     assigns every lucide-react module to `icons-vendor` — the chunk the app shell loads. The whole
 *     set would land in front of first paint for every visitor.
 *   - lucide's `DynamicIcon` / `dynamicIconImports` is one chunk *per icon*: ~1,800 files, each
 *     matched by workbox's `globPatterns` and so precached, and each copied into the APK by
 *     `cap sync`.
 *
 * What an icon actually is, is a short list of SVG elements. Read out of the installed package, so it
 * is always the set `lucide-react` itself ships and never needs regenerating by hand, and emitted as
 * one JSON module that `src/components/icons/lucideIcons.ts` fronts and vite.config.ts keeps out of
 * the precache (`ON_DEMAND_ROOTS`). ~66 kB brotli, fetched the first time a chosen icon is drawn.
 *
 * React `key`s are stripped (a third of the bytes, and the renderer supplies its own), and aliases
 * are kept as a map to their canonical name so an icon Lucide later renames still resolves.
 */

export const LUCIDE_ICONS_MODULE = 'virtual:lucide-icons';
const RESOLVED = `\0${LUCIDE_ICONS_MODULE}`;

/** Marks the module in the bundle, so scripts/checkBundle.ts can find it without knowing its name. */
export const LUCIDE_CATALOG_MARKER = 'lucide-icon-catalog';

const require = createRequire(import.meta.url);

async function buildCatalog() {
  const root = dirname(require.resolve('lucide-react/package.json'));
  const { version } = require('lucide-react/package.json');
  const dir = join(root, 'dist', 'esm', 'icons');

  /* Imported rather than parsed: each module exports its own `__iconData`, which is the format
     lucide's `DynamicIcon` reads too, so this breaks only when lucide breaks its own loader. An alias
     module re-exports another's default and carries no data, which is how the two are told apart. */
  const files = readdirSync(dir).filter((name) => name.endsWith('.mjs'));
  const modules = await Promise.all(
    files.map((name) => import(pathToFileURL(join(dir, name)).href)),
  );

  const icons = {};
  const aliases = {};
  for (const mod of modules) {
    const data = mod.__iconData;
    if (!data) continue;
    icons[data.name] = data.node.map(([tag, { key: _key, ...attrs }]) => [tag, attrs]);
    for (const alias of data.aliases ?? []) aliases[alias] = data.name;
  }

  const names = Object.keys(icons).sort();
  return {
    marker: LUCIDE_CATALOG_MARKER,
    version,
    icons: Object.fromEntries(names.map((name) => [name, icons[name]])),
    aliases,
  };
}

/** The Vite plugin. The catalog is built once per process, on first import, and only if imported. */
export function lucideIcons() {
  let catalog;
  return {
    name: 'diary-lucide-icons',
    resolveId(id) {
      return id === LUCIDE_ICONS_MODULE ? RESOLVED : undefined;
    },
    async load(id) {
      if (id !== RESOLVED) return undefined;
      catalog ??= buildCatalog();
      // JSON.parse over an object literal: V8 parses a JSON string several times faster than the
      // equivalent JavaScript, and this is the one module in the app that is almost entirely data.
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(await catalog))});`;
    },
  };
}
