import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { DEFAULT_LOCALE, localeCodes } from './scripts/locales.mjs';
import { computeNativeFingerprint } from './scripts/nativeFingerprint.mjs';

/**
 * Fills index.html's locale placeholders from the files in src/i18n/locales.
 *
 * The pre-hydration script has to know which languages exist before any module has loaded, and
 * that is the one place the app cannot derive the list at runtime. Injecting it here keeps
 * "add a language" to dropping in a JSON file, rather than that plus a literal in the HTML that
 * would go stale silently — the failure being a document labelled with the wrong language, which
 * nothing would ever surface.
 */
function localePlaceholders(): Plugin {
  return {
    name: 'diary-locale-placeholders',
    transformIndexHtml(html) {
      return html
        .replace(/__APP_DEFAULT_LOCALE__/g, DEFAULT_LOCALE)
        .replace(/__APP_LOCALES__/g, JSON.stringify(localeCodes()));
    },
  };
}

// The API port lives in the repo-root .env (shared with the server).
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
const apiPort = process.env.PORT ?? '3000';
// Expose the (public) Google client id to the bundle for native sign-in.
process.env.VITE_GOOGLE_CLIENT_ID ??= process.env.GOOGLE_CLIENT_ID;

/* The root package.json version is the single source of truth (bumped by the pre-commit hook).
   Baking it into the bundle lets the *running* code report its own version — which is what the
   OTA logic needs, since after a live update the JS is no longer the one shipped in the APK. */
const rootPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

const ENV_DIR = fileURLToPath(new URL('.', import.meta.url));
const ENV_PREFIX = ['VITE_', 'IS_'];

/* Heavy libraries split out of the entry chunk. Two reasons, in this order: a release that only
   changes app code leaves these chunks byte-identical, so a returning user re-downloads none of
   them; and the entry chunk stops being the place everything lands by default. */
const VENDOR_CHUNKS: Record<string, string[]> = {
  /* React did not need naming under the object form — it was reachable from the entry and simply
     stayed there. Under the function form Rollup hoists it into a shared chunk of its own and
     names that chunk after whichever module it happened to see first, which came out as
     `button-<hash>.js`: 227 kB of react-dom under the name of a UI component, and a name that
     would move the next time the import graph shifted. Naming it here is what makes it stable,
     which is the entire point of this table.

     Naming a package can only ever fix half of that, though — see chunkFileNames below for the
     half this table cannot reach. */
  'react-vendor': ['react', 'react-dom', 'scheduler'],
  // Reached from nearly every route, because @diary/shared's schemas are. Same story as React
  // above: Rollup already gives it a shared chunk on its own, this only makes the name stable.
  'schema-vendor': ['zod'],
  'db-vendor': ['dexie'],
  'date-vendor': ['date-fns'],
  /* The presentational primitive layer: Radix and the three styling helpers every `components/ui`
     file calls (`cn` is clsx + tailwind-merge; the variants are cva). Those three were unnamed and
     so kept landing in the shared app chunk — a few kB of dependency that never changes, re-hashed
     on every release because the app code around it did. They are here rather than in a chunk of
     their own because this one is already on the shell's critical path, so grouping them costs no
     extra request. */
  'ui-vendor': ['radix-ui', '@radix-ui', 'class-variance-authority', 'clsx', 'tailwind-merge'],
  'icons-vendor': ['lucide-react'],
  // Reached from the shell (the router is what renders it), so this is eager either way — but
  // naming it takes ~20 kB of never-changing dependency out of the shared app chunk's hash.
  'router-vendor': ['react-router'],
  'auth-vendor': ['better-auth', '@capgo/capacitor-social-login'],
  capacitor: [
    '@capacitor/core',
    '@capacitor/app',
    '@capacitor/haptics',
    '@capacitor/keyboard',
    // Pulled in by lib/notifications.ts, which the shell reconciles on every sync.
    '@capacitor/local-notifications',
    '@capacitor/preferences',
    '@capacitor/splash-screen',
    '@capacitor/status-bar',
    '@capgo/capacitor-updater',
  ],
  'telemetry-vendor': ['@logtail/browser'],
  // Only the entry tree and the suggestion review dialog drag anything, but both are reached
  // from lazy routes — so this rides along with them rather than the shell.
  'dnd-vendor': [
    '@dnd-kit/core',
    '@dnd-kit/sortable',
    '@dnd-kit/utilities',
    'framer-motion',
    'motion',
    'motion-dom',
    'motion-utils',
  ],
  'query-vendor': ['@tanstack/react-query'],
  'i18n-vendor': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
};

/* Rollup 5 (Vite 8) dropped the object form this used to be written as, so the same table is now
   applied by hand.
 *
 * The two forms are not quite equivalent, and the difference is why the table above gained a few
 * entries. The object form assigned a package *and everything it pulled in* to the chunk; a
 * function is only ever asked about one module at a time, so a dependency has to be named to land
 * anywhere on purpose. `@radix-ui/*` (which `radix-ui` re-exports) and framer-motion's `motion*`
 * runtime packages were previously swept along implicitly and would otherwise have fallen back
 * into the entry chunk — precisely what this whole table exists to prevent.
 *
 * Anything unnamed returns undefined and is placed by Rollup's own analysis, which is the right
 * default: a package used by exactly one lazy route belongs in that route's chunk, not in a
 * vendor bundle every visitor downloads.
 */
const CHUNK_BY_PACKAGE = new Map(
  Object.entries(VENDOR_CHUNKS).flatMap(([chunk, packages]) =>
    packages.map((pkg) => [pkg, chunk] as const),
  ),
);

function manualChunks(id: string): string | undefined {
  // Separators are platform-native on the way in; the package name never is.
  const path = id.replace(/\\/g, '/');
  const afterLast = path.split('node_modules/').pop();
  if (path === afterLast) return undefined; // not a dependency: app code
  const segments = afterLast!.split('/');
  // Scoped packages spend two segments on their name (@scope/name).
  const scoped = segments[0].startsWith('@');
  return (
    CHUNK_BY_PACKAGE.get(scoped ? `${segments[0]}/${segments[1]}` : segments[0]) ??
    // Lets a whole scope be claimed at once — see `@radix-ui` above.
    (scoped ? CHUNK_BY_PACKAGE.get(segments[0]) : undefined)
  );
}

/* Everything the table above deliberately does not name.
 *
 * A chunk that is neither an entry, a lazy route, nor one of ours is a *shared* chunk: code
 * Rolldown hoisted out because more than one route reached it. Those chunks get named after
 * whichever of their modules the bundler happened to see first, and that is a property of the
 * import graph rather than of the contents — so `button-<hash>.js` was 173 kB of db layer, lib
 * utilities, i18n runtime and @diary/shared, carrying the name of the one UI component in it.
 *
 * The name is not cosmetic. The filename is `[name]-[hash]`, so a name that moves changes the URL
 * of a file whose bytes did not change, and a returning visitor re-downloads it — the exact cost
 * this whole config exists to avoid. It had already moved once, from `react-dom`'s chunk to this
 * one, and the modules in it are the ones every route imports, so it would keep moving.
 *
 * The fix is not to hand-place app code in VENDOR_CHUNKS. Membership there is forced rather than
 * inferred, so a rule broad enough to catch `src/lib`'s shared half (apiClient, preferences,
 * notifications, …) would also drag in its route-local half (the backup exporter, the archive
 * writer, the transcription client, the contacts importer) and put all of it in front of first
 * paint.
 * Rolldown's own analysis is right about where app code goes; it is only wrong about what to
 * call the result. So name the result instead, and leave the graph alone.
 *
 * A one-module shared chunk keeps its name: a single member cannot be the *first* of several, so
 * that name describes the contents and is already stable. If it later gains a module its bytes
 * changed anyway, and the hash would have moved with or without the rename.
 */
const MANUAL_CHUNK_NAMES = new Set(Object.keys(VENDOR_CHUNKS));

/* Plugin locale files, given a directory of their own so the service worker can tell them apart.
 *
 * The default `assetFileNames` flattens everything into `assets/[name]-[hash][extname]`, which is
 * fine until two files share a basename and need *opposite* caching. That is exactly the case here:
 * `src/i18n/locales/en.json` and `src/plugins/<id>/locales/en.json` both emit as
 * `assets/en-<hash>.json`, and `workbox.globPatterns` includes `json` because the core locales must
 * be precached or the app comes up offline with no strings at all. Precaching plugin locales the
 * same way would put ~10 kB per plugin, in five languages, in front of every visitor — including
 * everyone who never enables a plugin. No `globIgnores` pattern can separate them while the names
 * are identical, so separate the paths instead.
 *
 * This is the Noto reasoning from the workbox block below, applied to a second asset kind: precache
 * what everyone needs, runtime-cache what only some do. Content hashing is unaffected.
 */
const PLUGIN_LOCALE_DIR = 'assets/plugin-locales';
/* `(?:^|[\\/])` and not just `[\\/]`: the two hooks below are handed the same file in two different
   forms — `assetFileNames` gets a *root-relative* `src/plugins/…` with no leading separator, while
   `assetsInlineLimit` gets an absolute path. Requiring a leading separator matched only the second,
   which is the quiet half: the files stopped being inlined and then simply landed in `assets/`
   under the same `en-<hash>.json` name as the core locales, precached along with them. */
const PLUGIN_LOCALE_SOURCE =
  /(?:^|[\\/])src[\\/]plugins[\\/][^\\/]+[\\/]locales[\\/][^\\/]+\.json$/;

/**
 * Keep plugin locales out of the JS, as files.
 *
 * Vite inlines any asset under `assetsInlineLimit` (4 kB by default) as a base64 data URI, and a
 * plugin's locale file is a few hundred bytes. The result was the exact inversion of the intent:
 * because the `import.meta.glob` that references them lives in `plugins/i18n.ts`, all five
 * languages of every plugin were inlined into the *day page* chunk — downloaded by everyone with a
 * diary, plugins enabled or not, and growing with every plugin that ships.
 *
 * Nothing about that is visible in the build output, either. The files simply aren't in `dist`, and
 * the directory this config so carefully routes them to comes out empty. Forcing them to stay
 * external is what makes the rest of the pipeline — the directory, the globIgnores, the runtime
 * cache — apply to anything at all.
 */
function assetsInlineLimit(filePath: string): boolean | undefined {
  // `false` = never inline. `undefined` = fall back to the default byte limit.
  return PLUGIN_LOCALE_SOURCE.test(filePath) ? false : undefined;
}

function assetFileNames(asset: { names?: string[]; originalFileNames?: string[] }): string {
  const source = asset.originalFileNames?.[0];
  return source && PLUGIN_LOCALE_SOURCE.test(source)
    ? `${PLUGIN_LOCALE_DIR}/[name]-[hash][extname]`
    : 'assets/[name]-[hash][extname]';
}

function chunkFileNames(chunk: {
  name: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  moduleIds: string[];
}): string {
  const named =
    chunk.isEntry || // the app entry
    chunk.isDynamicEntry || // a lazy route: named after the module it fronts
    MANUAL_CHUNK_NAMES.has(chunk.name) || // named by the table above
    chunk.moduleIds.length === 1; // sole member: the name is a description, not a lottery
  return named ? 'assets/[name]-[hash].js' : 'assets/shared-[hash].js';
}

/* The Capacitor build talks to the API cross-origin, so it *must* be given an absolute
   VITE_API_BASE (web/.env.app). If it isn't, `${API_BASE}/api/...` becomes a same-origin call to
   https://localhost — the webview's own asset server — and every request quietly goes nowhere:
   sign-in just sits on the login screen with no error. That is silent and ships happily, so fail
   the build instead. (This is exactly what happened when web/.env.app was still gitignored and
   therefore missing from CI checkouts.) */
function assertAppModeEnv(env: Record<string, string>): void {
  const missing = ['VITE_API_BASE', 'VITE_GOOGLE_CLIENT_ID'].filter((key) => !env[key]);
  if (missing.length === 0) return;
  throw new Error(
    `Cannot build the Capacitor app: ${missing.join(', ')} is empty.\n` +
      `VITE_API_BASE comes from web/.env.app; VITE_GOOGLE_CLIENT_ID from GOOGLE_CLIENT_ID in .env ` +
      `(or the GOOGLE_CLIENT_ID secret in CI).\n` +
      `Building without them produces an app that cannot reach the API or sign in.`,
  );
}

export default defineConfig(({ mode }) => {
  if (mode === 'app') assertAppModeEnv(loadEnv(mode, ENV_DIR, ENV_PREFIX));

  return {
    envPrefix: ENV_PREFIX,
    define: {
      __APP_VERSION__: JSON.stringify(rootPkg.version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __NATIVE_FINGERPRINT__: JSON.stringify(computeNativeFingerprint()),
    },
    plugins: [
      localePlaceholders(),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Diary',
          short_name: 'Diary',
          description: 'Personal diary with talking points, memories and people',
          start_url: '/diary',
          display: 'standalone',
          background_color: '#18181b',
          theme_color: '#18181b',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Data lives in the local Dexie store now; the SW only precaches the app shell.
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          /* Workbox's default list is js,css,html,ico,png,svg — no json, which the locale files
           became the moment they stopped being `import()`ed chunks and started being fetched by
           URL (see src/i18n/index.ts). Without this the app would come up offline with no strings
           at all, which is a far louder failure than the one that change was fixing.

           `woff2` is here for the same reason and was the same oversight: without it the five
           Geist subsets sit outside the shell cache, so a cold start offline renders the whole UI
           in the system fallback until the HTTP cache happens to hold them — a typeface change
           with no explanation attached to it.

           All five subsets are precached, not just the two the shipped languages need. The UI is
           latin, but the *content* is whatever the user writes, and a Cyrillic name in an entry
           should not be the one thing on the page in a different font. 84 kB buys that outright;
           `unicode-range` still means nothing extra is fetched at runtime.

           Noto is the one case where that reasoning inverts. Geist is 84 kB across five subsets;
           Noto JP and SC are 9.3 MB across ~225, so precaching them the same way would put a 9.3
           MB download in front of first paint for every visitor, in every language, to cover two.
           They are excluded from the manifest and picked up at runtime instead — the browser
           requests only the subsets it needs, and CacheFirst makes those offline-durable from
           second use. A ja/zh reader pays once for the handful of subsets their text touches;
           everyone else pays nothing. */
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2}'],
          /* Plugin locales are the `json` counterpart to the Noto exclusion, and for the same
             reason: `json` is in the pattern above so the *core* locales are precached, but a
             plugin's five files are needed only by the people who enable it, and precaching them
             would charge every visitor for every plugin that has ever shipped. They are picked up
             at runtime instead — see the CacheFirst rule below — which costs one fetch on enable
             and is offline-durable from then on. See assetFileNames above for why they need their
             own directory before this line can work at all. */
          globIgnores: ['**/noto-sans-{jp,sc}-*.woff2', 'assets/plugin-locales/**'],
          runtimeCaching: [
            {
              urlPattern: /\/assets\/plugin-locales\/[^/]*\.json$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'plugin-locales',
                // Hashed filenames, so an entry is immutable and only ever falls out on eviction.
                // Five languages per plugin; the cap is generous enough that an enabled plugin's
                // strings are never the thing evicted.
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /\/assets\/noto-sans-(jp|sc)-[^/]*\.woff2$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'cjk-font-subsets',
                // Hashed filenames, so an entry is immutable and only ever falls out on eviction.
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: [
        /* The CJK webfonts are a web-only asset.

         Fontsource ships Noto Sans JP and SC as ~225 `unicode-range` subsets between them. A
         browser fetches only the subsets whose codepoints are actually on the page, so serving
         them costs a latin reader nothing and gets ja/zh real Noto on every platform. `cap sync`
         has no such laziness — it copies all of dist/ into the APK, so the same two @imports are
         9.3 MB of woff2 that ships to every user regardless of language.

         Stubbing the packages here rather than branching in the CSS keeps the decision in one
         place, and makes it a resolver fact rather than something dead-code elimination has to be
         trusted to notice. index.css lists the system Noto right behind the '… Variable' name, so
         the APK simply falls through to the CJK faces Android already has. */
        ...(mode === 'app'
          ? [
              {
                find: /^@fontsource-variable\/noto-sans-(jp|sc)$/,
                replacement: fileURLToPath(new URL('./src/cjk-webfont-stub.css', import.meta.url)),
              },
            ]
          : []),
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      ],
    },
    server: {
      proxy: {
        // ws: true lets the live-sync WebSocket flow through the dev proxy too.
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false, ws: true },
      },
    },
    build: {
      assetsInlineLimit,
      rollupOptions: {
        output: {
          manualChunks,
          chunkFileNames,
          assetFileNames,
        },
      },
    },
  };
});
