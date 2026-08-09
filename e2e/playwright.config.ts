import { defineConfig, devices } from '@playwright/test';

/* End-to-end tests: a real Chromium against the built SPA, with the API answered by Playwright's
 * route interception rather than a server.
 *
 * That combination is chosen for what this app *is*. It is local-first: writing offline, queuing in
 * an outbox, draining on reconnect and reconciling a `reset: true` pull are the riskiest things it
 * does, and every one of them needs a real IndexedDB and a real network state — neither of which
 * jsdom has. What it does *not* need is a database: the server's own logic has unit tests, and
 * standing up MongoDB plus an auth bypass would buy fidelity in the half already covered while
 * making this suite unable to run in CI without secrets. So the browser is real and the server is a
 * fixture.
 */

/* Neither `import.meta.url` nor an ESM-only helper can be used in this file: the root package.json
   has no `"type": "module"`, so Playwright loads the config as CommonJS and `import.meta` is a
   syntax-level error there. Relative paths are the portable answer — Playwright resolves
   `webServer.cwd` against the directory holding this config, so '..' is the repo root. */
const PORT = 4173;
const repoRoot = '..';

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Zero locally so flake is visible while specs are being written; one in CI, because a runner
  // under load is a different machine from a laptop.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    /* The single most important line here. A production build registers a service worker, and one
       that has claimed the page serves `navigateFallback: '/index.html'` out of precache on the
       next navigation — so route interception silently stops seeing requests. Blocking the
       registration outright is the only version of this that cannot go wrong halfway through a
       run. `support/app.ts` hides `navigator.serviceWorker` as well, for belt and braces. */
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'en-GB',
    /* `todayKey()` is local time, and `/diary` redirects to today — so without a pinned zone the
       suite would compute a different day depending on where it runs. Specs derive the expected
       key with the app's own formula rather than hardcoding one. */
    timezoneId: 'UTC',
  },
  // One browser on purpose: the app ships to Chromium (the web, and Android's WebView). Firefox and
  // WebKit would triple install time to cover engines nothing is delivered to.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    /* `vite preview` over a pre-built web/dist, not the dev server. Three reasons, in order: it
       tests the artefact that actually ships (including the manualChunks/chunkFileNames split,
       which nothing else in this repo checks); it serves one request per chunk instead of
       transforming ~600 modules on demand per route; and a *production* React build does not
       double-invoke effects, which is what makes "the app queued exactly one entry" a stable
       assertion rather than a coin flip. */
    command: `npm run preview -w web -- --port ${PORT} --strictPort`,
    cwd: repoRoot,
    // Also proves the SPA history fallback, which a request for `/` would not.
    url: `http://localhost:${PORT}/diary`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
