import type { MiddlewareHandler } from 'hono';
import { trackEvent, userHash } from '../lib/telemetry';
import type { AppEnv } from './session';

/**
 * A fixed-window request cap, counted per user.
 *
 * Per *user*, not per IP: everything this guards sits behind requireAuth, and the app is used from
 * phones on carrier NAT where an IP is a whole neighbourhood. The user id is also the thing the
 * cost is attached to — these routes spend the caller's own Groq and OpenRouter quota.
 *
 * In-memory, and therefore per-process. That is the right size for how this deploys (one
 * container, per the README) and would need moving to a shared store the moment there are two.
 * It is deliberately not a reason to skip having a limit at all: the realistic trigger here is a
 * client retry loop, not a distributed attacker, and a retry loop is exactly what a per-process
 * counter catches.
 *
 * Fixed window rather than a token bucket or a sliding log: it costs one integer per user, and the
 * worst case it allows — a double burst either side of a window boundary — is not a meaningful
 * difference when the point is to stop something running away, not to meter it precisely.
 */

interface Window {
  count: number;
  /** Epoch ms at which this window expires and the count resets. */
  resetAt: number;
}

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  /** i18n key sent to the client on rejection. */
  code: string;
}

/** Never let the map grow without bound if a process runs for months. */
const SWEEP_EVERY = 1000;

export function rateLimit({ limit, windowMs, code }: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const windows = new Map<string, Window>();
  let sinceSweep = 0;

  return async (c, next) => {
    const userId = c.get('userId');
    const now = Date.now();

    if (++sinceSweep >= SWEEP_EVERY) {
      sinceSweep = 0;
      for (const [key, window] of windows) {
        if (window.resetAt <= now) windows.delete(key);
      }
    }

    const window = windows.get(userId);
    if (!window || window.resetAt <= now) {
      windows.set(userId, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (window.count >= limit) {
      /* Counted even though it is being refused. The window's own logic does not need this — once
         the cap is reached every request in the window is refused regardless of how far past it
         the count goes — but "how hard is this caller pushing" is only knowable if the rejections
         are counted too, and it is the number that tells a retry loop from a busy afternoon. */
      window.count += 1;
      /* Returned rather than thrown as an HttpError. handleError builds a fresh response from the
         status and code alone, which would drop Retry-After — and that header is the whole
         difference between a client that waits the right amount of time and one that guesses. The
         body keeps the same `{ error: <i18n key> }` shape every other failure uses. */
      const retryAfter = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
      /* The limiter exists to catch a client retry loop, and until now catching one was completely
         silent: the loop keeps running, the user sees a failure they can't explain, and the only
         record is a 429 in an access log nobody reads. `over_by` is what separates the two cases
         this middleware deliberately does not distinguish — someone who hit the cap by using the
         feature (a handful over) from a loop hammering it (hundreds over) — without needing a
         second counter to do it. */
      trackEvent('rate_limited', {
        user: userHash(userId),
        route: c.req.routePath,
        code,
        limit,
        over_by: window.count - limit,
        retry_after_s: retryAfter,
      });
      return c.json({ error: code }, 429, { 'Retry-After': String(retryAfter) });
    }

    window.count += 1;
    await next();
  };
}
