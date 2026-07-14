import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { UpgradeWebSocket } from 'hono/ws';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Auth } from './auth';
import { config } from './config';
import { handleError } from './errors';
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
  api.route('/settings', settingsRouter);
  api.route('/sync', syncRouter);
  api.route('/ai', aiRouter);
  app.route('/api', api);

  // Unknown API paths must 404 as JSON, never fall through to the SPA.
  app.all('/api/*', (c) => c.json({ error: 'errors.not_found' }, 404));

  app.use('*', serveStatic({ root: WEB_DIST, onFound: setCacheHeaders }));
  app.get('*', serveStatic({ path: `${WEB_DIST}/index.html`, onFound: setCacheHeaders }));

  return app;
};
