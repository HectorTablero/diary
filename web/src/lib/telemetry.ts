import { Logtail } from '@logtail/browser';
import { isNative } from './native';

/* Error + metrics reporting to Better Stack.

   Two rules shape this file, both from the app being offline-first:

     1. Telemetry must never break the app. Every call is best-effort and swallows its own
        failures — a logging backend being down is not the user's problem.
     2. Events raised offline are queued in memory and flushed when the connection returns,
        rather than thrown away. Offline is the normal case here, not the exception.

   Configured entirely by env vars; with none set the module degrades to console-only, so local
   development and anyone building without a Better Stack account are unaffected. */

const SOURCE_TOKEN = import.meta.env.VITE_BETTERSTACK_SOURCE_TOKEN;
const INGEST_URL = import.meta.env.VITE_BETTERSTACK_INGEST_URL;

/** Bounded, so a long offline session can't grow the queue without limit. */
const MAX_QUEUED = 50;

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

interface QueuedEvent {
  level: Level;
  message: string;
  fields: Fields;
}

const logtail = SOURCE_TOKEN && INGEST_URL ? new Logtail(SOURCE_TOKEN, { endpoint: INGEST_URL }) : null;
const queue: QueuedEvent[] = [];

/** Attached to every event so logs can be filtered by release and platform in Better Stack. */
function baseContext(): Fields {
  return {
    app_version: __APP_VERSION__,
    platform: isNative ? 'android' : 'web',
    native_fingerprint: __NATIVE_FINGERPRINT__,
  };
}

function send({ level, message, fields }: QueuedEvent): void {
  if (!logtail) return;
  // Logtail rejects when the network is gone; that must not surface as an unhandled rejection.
  void logtail[level](message, fields).catch(() => {
    /* dropped */
  });
}

function emit(level: Level, message: string, fields: Fields): void {
  const event: QueuedEvent = { level, message, fields: { ...baseContext(), ...fields } };

  if (!logtail) return;

  if (!navigator.onLine) {
    if (queue.length >= MAX_QUEUED) queue.shift();
    queue.push(event);
    return;
  }

  send(event);
}

function flushQueue(): void {
  const events = queue.splice(0, queue.length);
  for (const event of events) send(event);
}

function normaliseError(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack, name: err.name };
  return { message: String(err) };
}

/** Reports an error. Safe to call from anywhere, including offline and before init. */
export function captureError(err: unknown, fields: Fields = {}): void {
  const { message, stack, name } = normaliseError(err);
  console.error('[telemetry]', err);
  emit('error', message, { ...fields, error_name: name, stack });
}

/** Records a named event with arbitrary numeric/string fields — the basis for charts. */
export function trackEvent(name: string, fields: Fields = {}): void {
  emit('info', name, fields);
}

/** Times an async operation and reports its duration and outcome. */
export async function trackTiming<T>(name: string, run: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await run();
    trackEvent(name, { duration_ms: Math.round(performance.now() - startedAt), ok: true });
    return result;
  } catch (err) {
    trackEvent(name, { duration_ms: Math.round(performance.now() - startedAt), ok: false });
    throw err;
  }
}

export function initTelemetry(): void {
  if (!logtail) {
    console.info('[telemetry] disabled (no VITE_BETTERSTACK_SOURCE_TOKEN / VITE_BETTERSTACK_INGEST_URL)');
    return;
  }

  window.addEventListener('error', (event) => {
    captureError(event.error ?? event.message, { source: 'window.error' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    captureError(event.reason, { source: 'unhandledrejection' });
  });
  window.addEventListener('online', flushQueue);
  // The tab can vanish without warning on mobile; get whatever is buffered out first.
  window.addEventListener('pagehide', () => {
    void logtail.flush().catch(() => {
      /* dropped */
    });
  });

  trackEvent('app_started', { build_time: __BUILD_TIME__ });
}
