import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import type { UpgradeWebSocket } from 'hono/ws';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Auth } from './auth';
import { config } from './config';
import { handleError } from './errors';
import { buildAssetLinks } from './lib/assetLinks';
import { buildCsp } from './lib/csp';
import { requestTelemetry } from './lib/telemetry';
import {
  addLiveClient,
  notifyUserChanged,
  redeemWsTicket,
  removeLiveClient,
} from './services/liveSync';
import { requireAuth, type AppEnv } from './middleware/session';
import { aiRouter } from './routes/ai';
import { entriesRouter } from './routes/entries';
import { peopleRouter } from './routes/people';
import { settingsRouter } from './routes/settings';
import { syncRouter } from './routes/sync';
import { tagsRouter } from './routes/tags';
import { threadsRouter } from './routes/threads';

// serveStatic resolves relative to process.cwd(); compute the path to web/dist
// from this file so it works both from the repo root and inside the container.
const webDistAbs = fileURLToPath(new URL('../../web/dist', import.meta.url));
const WEB_DIST = (relative(process.cwd(), webDistAbs) || '.').replace(/\\/g, '/');

/** Vite fingerprints everything it emits into /assets/, so those URLs can never change meaning. */
const HASHED_ASSET = /[\\/]assets[\\/]/;

/* Cache headers for the SPA.

   Without these the origin sends no Cache-Control at all, and a CDN in front of it falls back to
   caching by file extension — which is how Cloudflare ended up serving a four-hour-old `sw.js`.
   A stale service worker is uniquely damaging: the browser's update check re-fetches sw.js, gets
   the cached copy back, concludes there is no new version, and keeps serving its old precache
   forever. The site then looks frozen on an old build even though the server has the new one
   (a hard reload bypasses the worker and shows the truth, a normal reload goes back to the past).

   So: fingerprinted assets are immutable, and everything else — above all the service worker and
   the HTML shell — must be revalidated on every request. */
const setCacheHeaders = (path: string, c: Context): void => {
  c.header(
    'Cache-Control',
    HASHED_ASSET.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
};

/** Populates the given app (created by the caller so WebSocket upgrades can be wired in). */
export const buildApp = (app: Hono<AppEnv>, auth: Auth, upgradeWebSocket?: UpgradeWebSocket) => {
  app.use(logger());
  app.use(requestTelemetry());
  app.onError(handleError);

  /* Security headers, on every response including the API's.

     The CSP is built once at startup rather than per request — it reads the built index.html to
     hash its inline scripts (see lib/csp.ts), which must not happen on the hot path.

     `crossOriginEmbedderPolicy` stays off: it would require every cross-origin subresource to opt
     in via CORP, and the signed-in user's Google profile picture does not. Nothing here needs the
     cross-origin isolation it buys. `xFrameOptions` is left to the CSP's frame-ancestors, which
     supersedes it everywhere the app runs. */
  app.use(
    secureHeaders({
      contentSecurityPolicy: buildCsp(`${WEB_DIST}/index.html`),
      crossOriginEmbedderPolicy: false,
      referrerPolicy: 'strict-origin-when-cross-origin',
      xContentTypeOptions: 'nosniff',
      // HSTS is only meaningful over TLS, and the dev server is plain http on localhost.
      strictTransportSecurity:
        config.betterAuthUrl.startsWith('https://') ? 'max-age=31536000; includeSubDomains' : false,
    }),
  );

  // The Capacitor app calls the API cross-origin from the native webview.
  app.use(
    '/api/*',
    cors({
      origin: [config.betterAuthUrl, 'https://localhost', 'capacitor://localhost'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Client-Id'],
      exposeHeaders: ['set-auth-token'],
      credentials: true,
    }),
  );

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  // Live-sync channel. The upgrade URL carries only a single-use short-lived
  // ticket (issued by GET /api/sync/ws-ticket behind normal auth) — never the
  // session token, which would otherwise leak into access logs.
  if (upgradeWebSocket) {
    app.get('/api/sync/ws', async (c, next) => {
      const ticket = c.req.query('ticket');
      const userId = ticket ? redeemWsTicket(ticket) : null;
      if (!userId) return c.json({ error: 'errors.unauthorized' }, 401);

      const clientId = c.req.query('client') ?? '';
      return upgradeWebSocket(() => ({
        onOpen: (_evt, ws) => addLiveClient(userId, clientId, ws),
        onClose: (_evt, ws) => removeLiveClient(userId, ws),
      }))(c, next);
    });
  }

  const api = new Hono<AppEnv>();
  api.use(requireAuth(auth));
  // Any successful mutation nudges the user's other connected devices to pull.
  api.use(async (c, next) => {
    await next();
    if (c.req.method !== 'GET' && c.res.status < 400) {
      notifyUserChanged(c.get('userId'), c.req.header('x-client-id') ?? null);
    }
  });
  /* The client is local-first: it reads exclusively from its own Dexie store and reconciles via
     GET /sync, so the API only needs to accept *writes* (replayed from the client's outbox) plus
     the sync pull and the AI assistant. The read endpoints this once served — day entries, the
     people list, talking points, memories, history, calendar, on-this-day, search — are all
     computed on the client now (web/src/db/repo.ts) and have been removed. */
  api.route('/entries', entriesRouter);
  api.route('/people', peopleRouter);
  api.route('/tags', tagsRouter);
  api.route('/threads', threadsRouter);
  api.route('/settings', settingsRouter);
  api.route('/sync', syncRouter);
  api.route('/ai', aiRouter);
  app.route('/api', api);

  // Unknown API paths must 404 as JSON, never fall through to the SPA.
  app.all('/api/*', (c) => c.json({ error: 'errors.not_found' }, 404));

  /* Android App Links verification (see lib/assetLinks.ts).

     A route rather than a static file under web/public: the fingerprints belong to whoever signs
     the APK, so they are configuration, not a build artefact — a self-hosted deployment signs with
     its own key and must be able to say so without editing the repo. Serving it from here also
     keeps it out of the service worker's precache, where a stale copy would be answered to
     Android's re-verification long after the real one changed.

     404 rather than an empty statement list when nothing is configured: an empty `[]` is a valid
     document that positively asserts no app may handle these links, which is worse than saying
     nothing at all. */
  app.get('/.well-known/assetlinks.json', (c) => {
    const { statements, malformed } = buildAssetLinks();
    if (malformed.length) {
      // Named, not counted — this is almost always a SHA-1 pasted where SHA-256 was meant.
      console.warn(
        `[assetlinks] ignoring ${malformed.length} fingerprint(s) that are not 32 colon-separated hex bytes`,
      );
    }
    if (!statements.length) return c.json({ error: 'errors.not_found' }, 404);
    // Explicit content type: Android rejects the statement file if it is not application/json.
    return c.json(statements, 200, { 'Cache-Control': 'public, max-age=3600' });
  });

  /* Backslashes never reach serveStatic.

     GHSA-frvp-7c67-39w9: on Windows, @hono/node-server's serve-static treats an encoded backslash
     as a path separator, so `%5C..%5C` escapes the static root and reads arbitrary files. There is
     no fixed version to upgrade to — it is the one advisory `npm audit fix` cannot clear.

     Production runs on Alpine, where the vector does not apply, but `npm start` on a Windows
     machine is a documented way to run this app and the exposure there is real. No legitimate URL
     in this app contains a backslash in any form: Vite emits `/assets/<name>-<hash>.<ext>` and
     every route is a plain path, so rejecting them outright costs nothing.

     Placed here rather than in a global middleware so it sits directly in front of the thing it
     protects, and so the API's own 404 above still answers in JSON. */
  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (path.includes('\\') || /%5c/i.test(c.req.url)) {
      return c.text('Bad Request', 400);
    }
    await next();
  });

  app.use('*', serveStatic({ root: WEB_DIST, onFound: setCacheHeaders }));
  app.get('*', serveStatic({ path: `${WEB_DIST}/index.html`, onFound: setCacheHeaders }));

  return app;
};
