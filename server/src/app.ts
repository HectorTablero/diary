import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Auth } from './auth';
import { config } from './config';
import { handleError } from './errors';
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

export const buildApp = (auth: Auth) => {
  const app = new Hono<AppEnv>();
  app.use(logger());
  app.onError(handleError);

  // The Capacitor app calls the API cross-origin from the native webview.
  app.use(
    '/api/*',
    cors({
      origin: [config.betterAuthUrl, 'https://localhost', 'capacitor://localhost'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['set-auth-token'],
      credentials: true,
    }),
  );

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  const api = new Hono<AppEnv>();
  api.use(requireAuth(auth));
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
