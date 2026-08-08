import { Logtail } from '@logtail/node';
import type { MiddlewareHandler } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { config } from '../config';
import type { AppEnv } from '../middleware/session';

/* Error + metrics reporting to Better Stack.

   Falls back to console-only when the env vars are absent, so nothing here is load-bearing for
   running the server.

   This reports to a *different* Better Stack source than the client does — the client's token is
   shipped inside the bundle and must never be the server's. The two are joined by `client_id`:
   the browser sends it as `X-Client-Id` on every request (it already did, for live-sync echo
   suppression), and requestTelemetry records it, so a slow pull complained about by an app and the
   request that served it can be lined up across the two sources. */

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

/* There is deliberately no `trackTiming` helper on this side.
 *
 * Every timed thing here — the sync queries, the Groq leg, a request's own duration — reports a
 * handful of fields alongside the duration that decide what the number means: whether the branch
 * was a reset, whether the upstream fell back to the other model, how old the cursor was. A
 * wrapper that only knows a name and a promise cannot carry any of those, so each site measures
 * with two lines of its own and says what it measured. The client keeps its wrapper because it has
 * a call that genuinely is just a name and a promise (useAiSuggestions). */

/* Who a row belongs to, without saying who they are.
 *
 * "How many people hit this today", "is this one account or the whole fleet" and "did the same
 * account see it twice" are the questions that make an error report actionable, and all three need
 * only a stable pseudonym. A raw user id is a database key: it joins a log line to a person's
 * diary, and it does not belong in a third-party log service that this app makes optional
 * precisely because some people will not want it.
 *
 * Salted with BETTER_AUTH_SECRET so the hash cannot be recovered by hashing every ObjectId in a
 * candidate range — the space is small enough to enumerate, so an unsalted digest would be a
 * reversible identifier with extra steps. The secret is read lazily and through a fallback,
 * because config's required-getters throw and *importing* this module must never demand a
 * credential (see the note in config.ts). A random fallback loses cross-restart comparability,
 * which is the correct thing to lose in an installation with no secret configured. */
let hashSalt: string | null = null;
const getHashSalt = (): string => {
  if (hashSalt === null) {
    try {
      hashSalt = config.betterAuthSecret;
    } catch {
      hashSalt = randomBytes(16).toString('hex');
    }
  }
  return hashSalt;
};

export const userHash = (userId: string | undefined): string | undefined =>
  userId
    ? createHash('sha256').update(`${getHashSalt()}:${userId}`).digest('hex').slice(0, 12)
    : undefined;

/* Better Stack's free tier is a monthly volume, and one row per API request is the single easiest
   way to spend all of it on nothing. A local-first client polls /api/sync every sixty seconds per
   open tab and pushes an op per keystroke-ish edit, so the overwhelming majority of these rows are
   a 200 on a route that did what it always does.
 *
 * What survives in full is everything that is *not* that: any non-2xx, and anything slow enough to
 * be felt. The healthy remainder is sampled, which is all a latency percentile or a throughput
 * chart needs — those are distributions, and a tenth of a distribution has the same shape.
 *
 * The one number to keep honest is the sample rate itself: a rate chart built from sampled rows
 * has to be divided by it, so it is recorded on the row rather than left as folklore in a comment. */
const HTTP_SAMPLE_RATE = 0.1;
const SLOW_REQUEST_MS = 1000;

/** One structured event per API request — the raw material for latency and error-rate charts. */
export function requestTelemetry(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // Static asset serving would drown out the signal; only the API is interesting.
    if (!c.req.path.startsWith('/api/')) return next();

    const startedAt = performance.now();
    await next();
    const durationMs = Math.round(performance.now() - startedAt);

    const status = c.res.status;
    const notable = status >= 300 || durationMs >= SLOW_REQUEST_MS;
    if (!notable && Math.random() >= HTTP_SAMPLE_RATE) return;

    trackEvent('http_request', {
      method: c.req.method,
      // The matched route, not the raw path: /api/entries/:id, never a specific entry id.
      route: c.req.routePath,
      status,
      duration_ms: durationMs,
      // Set by both the REST client and the transcription upload; absent for anything else,
      // which is itself worth seeing (a request from something that is not our app).
      client_id: c.req.header('x-client-id'),
      /* c.get('userId') is only populated behind requireAuth, so this is absent exactly where
         there is no session — /api/health, /api/auth/*, and any request that got rejected before
         reaching the guard. */
      user: userHash(c.get('userId')),
      sample_rate: notable ? 1 : HTTP_SAMPLE_RATE,
    });
  };
}

/* Process health, once a minute.
 *
 * ~1,400 rows a day total — not per user, per *container* — which is nothing against the budget
 * and is the difference between "the API went quiet at 3am" and knowing it was the heap. Event
 * loop lag is in here because this process serves a WebSocket per open client and does its Mongo
 * work in parallel: a blocked loop shows up to every one of them at once as a stall, and it is
 * invisible in per-request timings, which are measured from inside the very loop that is late. */
const RUNTIME_METRICS_INTERVAL_MS = 60_000;

/**
 * @param gauges Extra levels to attach, sync or async. Async because some of them are a database
 * query — the tombstone count and its oldest row — and a gauge whose only honest source is Mongo
 * should not be excluded by the shape of this callback. A rejection is swallowed rather than
 * allowed to skip the row: the process figures worth knowing (heap, loop lag) are the ones that
 * still work when the database is the thing that is broken, which is exactly when they matter.
 */
export function startRuntimeMetrics(gauges: () => Fields | Promise<Fields> = () => ({})): void {
  if (!logtail) return;
  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();

  const timer = setInterval(() => {
    void (async () => {
      let extra: Fields = {};
      try {
        extra = await gauges();
      } catch (err) {
        captureError(err, { scope: 'runtimeMetrics.gauges' });
      }
      emitRuntimeMetrics(extra, loopDelay);
    })();
  }, RUNTIME_METRICS_INTERVAL_MS);

  // Never hold the process open for a metrics tick.
  timer.unref();
}

function emitRuntimeMetrics(
  extra: Fields,
  loopDelay: ReturnType<typeof monitorEventLoopDelay>,
): void {
  const memory = process.memoryUsage();
  trackEvent('runtime_metrics', {
    ...extra,
    rss_mb: Math.round(memory.rss / 1024 / 1024),
    heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(memory.heapTotal / 1024 / 1024),
    // Mean and p99 rather than the whole histogram: the mean says whether the process is busy,
    // the p99 says whether anyone noticed.
    loop_lag_mean_ms: Math.round(loopDelay.mean / 1e6),
    loop_lag_p99_ms: Math.round(loopDelay.percentile(99) / 1e6),
    uptime_s: Math.round(process.uptime()),
  });
  /* The histogram is cumulative; reset so each row describes its own minute rather than all of them
     since boot, which would flatten into uselessness after a day. Reset here rather than in the
     caller so it happens exactly once per emitted row — an awaited gauge means the two are no
     longer trivially the same place. */
  loopDelay.reset();
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
