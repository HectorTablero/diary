import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { UpgradeWebSocket } from 'hono/ws';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Auth } from './auth';
import { config } from './config';
import { handleError } from './errors';
import {
  addLiveClient,
  notifyUserChanged,
  redeemWsTicket,
  removeLiveClient,
} from './services/liveSync';
import { requireAuth, type AppEnv } from './middleware/session';
import { calendarRouter, onThisDayRouter } from './routes/calendar';
import { entriesRouter } from './routes/entries';
import { peopleRouter } from './routes/people';
import { searchRouter } from './routes/search';
import { settingsRouter } from './routes/settings';
import { syncRouter } from './routes/sync';
import { tagsRouter } from './routes/tags';

// serveStatic resolves relative to process.cwd(); compute the path to web/dist
// from this file so it works both from the repo root and inside the container.
const webDistAbs = fileURLToPath(new URL('../../web/dist', import.meta.url));
const WEB_DIST = (relative(process.cwd(), webDistAbs) || '.').replace(/\\/g, '/');

/** Populates the given app (created by the caller so WebSocket upgrades can be wired in). */
export const buildApp = (app: Hono<AppEnv>, auth: Auth, upgradeWebSocket?: UpgradeWebSocket) => {
  app.use(logger());
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
  api.route('/entries', entriesRouter);
  api.route('/people', peopleRouter);
  api.route('/tags', tagsRouter);
  api.route('/settings', settingsRouter);
  api.route('/calendar', calendarRouter);
  api.route('/on-this-day', onThisDayRouter);
  api.route('/search', searchRouter);
  api.route('/sync', syncRouter);
  app.route('/api', api);

  // Unknown API paths must 404 as JSON, never fall through to the SPA.
  app.all('/api/*', (c) => c.json({ error: 'errors.not_found' }, 404));

  app.use('*', serveStatic({ root: WEB_DIST }));
  app.get('*', serveStatic({ path: `${WEB_DIST}/index.html` }));

  return app;
};
