import { Hono } from 'hono';
import { handleError } from '../errors';
import type { AppEnv } from '../middleware/session';

/* Mounting one router the way app.ts mounts it, minus everything that isn't it.
 *
 * Two pieces are not optional and are the reason this helper exists rather than each test building
 * its own app. `onError(handleError)` is what turns the `notFound()`/`conflict()` a handler *throws*
 * into a status and an i18n key — without it Hono answers a bare 500 and every error-mapping
 * assertion in these files would be testing Hono's default. And `c.set('userId', …)` stands in for
 * requireAuth, which is the only thing a router downstream of it needs from the session.
 *
 * The user id is a parameter because the sharpest assertion available here is a *negative* one:
 * every filter a route builds has to carry the caller's own id, and the way to see that is to make
 * the id distinctive and then read it back off the spy.
 */

export const USER_ID = 'user_under_test';

/** A second identity, for asserting that one user's id never appears in another's query. */
export const OTHER_USER_ID = 'user_somebody_else';

/**
 * @param sessionCreatedAt When the caller last signed in. Every route but one is indifferent to it,
 * so it defaults to a session created the instant the request is made; DELETE /account refuses a
 * session older than a few minutes, and its tests are the only ones that pass a date.
 */
export function routeApp(
  path: string,
  router: Hono<AppEnv>,
  userId: string = USER_ID,
  sessionCreatedAt?: Date,
) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    // Read per request rather than captured once, so the default never goes stale partway through
    // a slow suite and quietly starts testing the refusal path instead.
    c.set('sessionCreatedAt', sessionCreatedAt ?? new Date());
    await next();
  });
  app.route(path, router);
  return app;
}

/** `app.request` with a JSON body, since almost every write here takes one. */
export const postJson = (
  app: ReturnType<typeof routeApp>,
  path: string,
  body: unknown,
  method = 'POST',
) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
