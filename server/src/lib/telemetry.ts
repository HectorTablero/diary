import { Logtail } from '@logtail/node';
import type { MiddlewareHandler } from 'hono';
import { config } from '../config';
import type { AppEnv } from '../middleware/session';

/* Error + metrics reporting to Better Stack.

   Falls back to console-only when the env vars are absent, so nothing here is load-bearing for
   running the server. */

const logtail =
  config.betterStackToken && config.betterStackIngestUrl
    ? new Logtail(config.betterStackToken, { endpoint: config.betterStackIngestUrl })
    : null;

type Fields = Record<string, unknown>;

const baseContext = (): Fields => ({ app_version: config.appVersion, service: 'server' });

export function trackEvent(name: string, fields: Fields = {}): void {
  void logtail?.info(name, { ...baseContext(), ...fields }).catch(() => {
    /* never let logging break a request */
  });
}

export function captureError(err: unknown, fields: Fields = {}): void {
  console.error(err);
  const error = err instanceof Error ? err : new Error(String(err));
  void logtail
    ?.error(error.message, {
      ...baseContext(),
      ...fields,
      error_name: error.name,
      stack: error.stack,
    })
    .catch(() => {
      /* ignore */
    });
}

/** One structured event per API request — the raw material for latency and error-rate charts. */
export function requestTelemetry(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // Static asset serving would drown out the signal; only the API is interesting.
    if (!c.req.path.startsWith('/api/')) return next();

    const startedAt = performance.now();
    await next();

    trackEvent('http_request', {
      method: c.req.method,
      // The matched route, not the raw path: /api/entries/:id, never a specific entry id.
      route: c.req.routePath,
      status: c.res.status,
      duration_ms: Math.round(performance.now() - startedAt),
    });
  };
}

/** Best-effort delivery of anything still buffered when the container is told to stop. */
export async function flushTelemetry(): Promise<void> {
  try {
    await logtail?.flush();
  } catch {
    /* ignore */
  }
}

export const telemetryEnabled = logtail !== null;
