import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { computeNativeFingerprint } from './scripts/nativeFingerprint.mjs';

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
           at all, which is a far louder failure than the one that change was fixing. */
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
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
        /* Heavy libraries split out of the entry chunk. Two reasons, in this order: a release
           that only changes app code leaves these chunks byte-identical, so a returning user
           re-downloads none of them; and the entry chunk stops being the place everything lands
           by default. */
        manualChunks: {
          'db-vendor': ['dexie'],
          'date-vendor': ['date-fns'],
          'radix-vendor': ['radix-ui'],
          'icons-vendor': ['lucide-react'],
          'auth-vendor': ['better-auth', '@capgo/capacitor-social-login'],
          'capacitor': ['@capacitor/core', '@capacitor/app', '@capacitor/haptics', '@capacitor/keyboard', '@capacitor/preferences', '@capacitor/splash-screen', '@capacitor/status-bar', '@capgo/capacitor-updater'],
          'telemetry-vendor': ['@logtail/browser'],
          // Only the entry tree and the suggestion review dialog drag anything, but both are
          // reached from lazy routes — so this rides along with them rather than the shell.
          'dnd-vendor': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', 'framer-motion'],
          'query-vendor': ['@tanstack/react-query'],
          'i18n-vendor': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
        },
      },
    },
  },
  };
});
