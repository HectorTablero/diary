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
        manualChunks: {
          // Heavy libraries that are used across the app but not needed for first paint
          'db-vendor': ['dexie', 'fake-indexeddb'],
          'date-vendor': ['date-fns'],
          'radix-vendor': ['radix-ui'],
          'icons-vendor': ['lucide-react'],
          'auth-vendor': ['better-auth', '@capgo/capacitor-social-login'],
          'capacitor': ['@capacitor/core', '@capacitor/app', '@capacitor/haptics', '@capacitor/keyboard', '@capacitor/preferences', '@capacitor/splash-screen', '@capacitor/status-bar', '@capgo/capacitor-updater'],
          'telemetry-vendor': ['@logtail/browser'],
        },
      },
    },
  },
  };
});
