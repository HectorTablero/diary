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
const rootPkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

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
     which is the entire point of this table. */
  'react-vendor': ['react', 'react-dom', 'scheduler'],
  // Reached from nearly every route, because @diary/shared's schemas are. Same story as React
  // above: Rollup already gives it a shared chunk on its own, this only makes the name stable.
  'schema-vendor': ['zod'],
  'db-vendor': ['dexie'],
  'date-vendor': ['date-fns'],
  'radix-vendor': ['radix-ui', '@radix-ui'],
  'icons-vendor': ['lucide-react'],
  'auth-vendor': ['better-auth', '@capgo/capacitor-social-login'],
  capacitor: ['@capacitor/core', '@capacitor/app', '@capacitor/haptics', '@capacitor/keyboard', '@capacitor/preferences', '@capacitor/splash-screen', '@capacitor/status-bar', '@capgo/capacitor-updater'],
  'telemetry-vendor': ['@logtail/browser'],
  // Only the entry tree and the suggestion review dialog drag anything, but both are reached
  // from lazy routes — so this rides along with them rather than the shell.
  'dnd-vendor': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', 'framer-motion', 'motion', 'motion-dom', 'motion-utils'],
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
           `unicode-range` still means nothing extra is fetched at runtime. */
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // ws: true lets the live-sync WebSocket flow through the dev proxy too.
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false, ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  };
});
