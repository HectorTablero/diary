import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './session';

/**
 * Refuse a state-changing request that announces an origin this deployment doesn't trust.
 *
 * Two things already stand between a hostile page and these endpoints, and both work — but both are
 * something *else's* correctness, and this file is the one that says so out loud:
 *
 *  - **Preflight.** Every mutation here is either a non-simple method (PUT/PATCH/DELETE) or a POST
 *    carrying `application/json`, so the browser must preflight it, and the CORS allowlist in app.ts
 *    fails that preflight for anyone else. Cover the whole surface and it depends on no endpoint
 *    ever accepting a form-encoded or text/plain body, which is a property of every current
 *    handler rather than a rule anything enforces.
 *  - **`SameSite=Lax`** on the session cookie, which is what stops a cross-site form POST — the
 *    classic preflight bypass — from carrying credentials at all. That is Better Auth's default,
 *    not a setting this repo states, so it is one dependency upgrade away from being a different
 *    default.
 *
 * Neither is wrong today. But the endpoints behind this include one that erases a user's diary
 * irreversibly, and "the browser will refuse to send it" is a bad last line for that. So the origin
 * is checked here, in this codebase, against the same list CORS uses.
 *
 * **A missing `Origin` is allowed, deliberately.** Browsers attach it to every non-GET request,
 * cross-origin or not — so its absence means the caller is not a browser (curl, a native HTTP
 * plugin, a script), and a non-browser caller has no ambient cookie jar for an attacker's page to
 * borrow. CSRF is precisely the attack that needs a browser. Rejecting on absence would break
 * legitimate non-browser clients to defend against nothing.
 *
 * `Sec-Fetch-Site` is deliberately *not* used to reject. The Android app is a genuine cross-site
 * caller — a webview on `https://localhost` talking to the deployed server — so `cross-site` is a
 * normal value here and carries no information the origin allowlist doesn't already have.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const requireTrustedOrigin = (trusted: string[]): MiddlewareHandler<AppEnv> => {
  const allowed = new Set(trusted);
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const origin = c.req.header('Origin');
    if (origin && !allowed.has(origin)) {
      return c.json({ error: 'errors.forbidden' }, 403);
    }
    await next();
  };
};
