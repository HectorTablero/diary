import { Logtail } from '@logtail/browser';
import { CLIENT_ID } from './apiClient';
import { isNative } from './native';
import { getPreferences } from './preferences';

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

const logtail =
  SOURCE_TOKEN && INGEST_URL ? new Logtail(SOURCE_TOKEN, { endpoint: INGEST_URL }) : null;
const queue: QueuedEvent[] = [];

/** Whether this build has somewhere to report to at all. Used by Settings to decide whether the
    opt-out is worth showing: a switch that cannot change anything is worse than an absent one. */
export const isTelemetryConfigured = (): boolean => logtail !== null;

/**
 * Whether to report right now.
 *
 * Read per event rather than captured once, so turning the switch off takes effect immediately
 * instead of at the next launch. The build-time env vars decide whether reporting is *possible*;
 * this preference is what decides whether it *happens*, which is the part that belongs to the
 * person using the app rather than to whoever produced the build.
 */
const reportingAllowed = (): boolean => logtail !== null && getPreferences().telemetry;

/** Attached to every event so logs can be filtered by release and platform in Better Stack. */
function baseContext(): Fields {
  return {
    app_version: __APP_VERSION__,
    platform: isNative ? 'android' : 'web',
    native_fingerprint: __NATIVE_FINGERPRINT__,
    /* The same id the REST client already sends as `X-Client-Id`, which the server now records on
       every request it logs.

       This is the *only* thing joining the two Better Stack sources. They are separate on purpose —
       the client token ships inside the bundle and must not be the server's — so a slow pull seen
       from the app and the request that served it are two unrelated rows unless something is
       carried across, and this is it. One page load (one app launch) gets one id, which makes it
       the session key on this side as well; it is random per launch and identifies no person. */
    client_id: CLIENT_ID,
  };
}

function send({ level, message, fields }: QueuedEvent): void {
  if (!logtail || !reportingAllowed()) return;
  // Logtail rejects when the network is gone; that must not surface as an unhandled rejection.
  void logtail[level](message, fields).catch(() => {
    /* dropped */
  });
}

function emit(level: Level, message: string, fields: Fields): void {
  /* First, before the event is even built.
     Checking before the *queue* was always the point — opted out, nothing should accumulate in
     memory waiting for a reconnect that would then ship it — but it used to happen after
     baseContext() had already run, which made a disabled telemetry module do real work on every
     call and, worse, made it capable of *failing* on one. Now that the sync engine calls in from a
     hot path, "off" has to mean nothing happens at all, including nothing that could throw. */
  if (!reportingAllowed()) return;

  const event: QueuedEvent = { level, message, fields: { ...baseContext(), ...fields } };

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

/**
 * Whether to report *this* occurrence of a high-frequency event.
 *
 * Better Stack's free tier is a monthly volume, and the events worth sampling are precisely the
 * ones that would spend it. A sync pass fires on every mutation, every foreground, every reconnect
 * and every sixty seconds regardless — roughly 1,400 a day per open client, nearly all of them
 * reporting that nothing changed. Sampling those keeps the shape of the latency distribution,
 * which is all a chart of it needs, for a twentieth of the volume.
 *
 * The rule this is only ever used under: **sample the uneventful, never the eventful.** Anything
 * carrying a failure, a rejection, a reset or a state transition is rare by construction, and the
 * one occurrence dropped is the one that was worth the whole exercise.
 */
export const sampled = (rate: number): boolean => Math.random() < rate;

/* Startup and rendering quality, reported once per session.
 *
 * Gathered from PerformanceObserver directly rather than by adding the `web-vitals` package: LCP
 * and CLS are two observers and a running total, and a telemetry module has no business being a
 * reason the bundle grew. INP is deliberately absent — measuring it properly is a great deal more
 * than this, and a long-task count answers the question one would act on ("is the main thread
 * being blocked, and by roughly how much?") without pretending to a standard metric it isn't.
 *
 * Nothing here is collected for a device fingerprint: no memory size, no core count, no user agent
 * beyond the platform already in baseContext. It is a diary. */
let largestContentfulPaint = 0;
let cumulativeLayoutShift = 0;
let longTaskCount = 0;
let longTaskTotalMs = 0;
let vitalsReported = false;

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

function observe(type: string, onEntries: (entries: PerformanceEntryList) => void): void {
  try {
    new PerformanceObserver((list) => onEntries(list.getEntries())).observe({
      type,
      buffered: true, // entries from before this ran — LCP's best candidate is usually one of them
    });
  } catch {
    // An entry type this browser doesn't implement: it simply contributes no field.
  }
}

function observeVitals(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  observe('largest-contentful-paint', (entries) => {
    // Only the last one counts: LCP is re-reported as bigger candidates paint.
    largestContentfulPaint = Math.round(entries[entries.length - 1]?.startTime ?? 0);
  });
  observe('layout-shift', (entries) => {
    for (const entry of entries as LayoutShiftEntry[]) {
      // Shifts within 500ms of an interaction are the user's own doing, not a defect.
      if (!entry.hadRecentInput) cumulativeLayoutShift += entry.value;
    }
  });
  observe('longtask', (entries) => {
    longTaskCount += entries.length;
    for (const entry of entries) longTaskTotalMs += entry.duration;
  });
}

/** One `web_vitals` event per session, at the last moment the page is still able to send one. */
function reportVitals(): void {
  if (vitalsReported) return;
  vitalsReported = true;
  const nav = performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  trackEvent('web_vitals', {
    lcp_ms: largestContentfulPaint || undefined,
    cls: Math.round(cumulativeLayoutShift * 1000) / 1000,
    long_tasks: longTaskCount,
    long_task_ms: Math.round(longTaskTotalMs),
    ttfb_ms: nav && Math.round(nav.responseStart),
    dom_interactive_ms: nav && Math.round(nav.domInteractive),
    session_ms: Math.round(performance.now()),
  });
}

export function initTelemetry(): void {
  if (!logtail) {
    console.info(
      '[telemetry] disabled (no VITE_BETTERSTACK_SOURCE_TOKEN / VITE_BETTERSTACK_INGEST_URL)',
    );
    return;
  }

  window.addEventListener('error', (event) => {
    captureError(event.error ?? event.message, { source: 'window.error' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    captureError(event.reason, { source: 'unhandledrejection' });
  });
  window.addEventListener('online', flushQueue);
  observeVitals();
  /* The tab can vanish without warning on mobile; get whatever is buffered out first, and take the
     one-per-session vitals event with it.

     Both events, because neither is reliable alone: `pagehide` does not fire when Android kills a
     backgrounded webview, and `visibilitychange` fires on every app switch — which is why
     reportVitals() is idempotent and this is the only place it is called from. Whichever arrives
     first is the one that reports; the other finds the work already done. */
  const finish = () => {
    reportVitals();
    void logtail.flush().catch(() => {
      /* dropped */
    });
  };
  window.addEventListener('pagehide', finish);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finish();
  });

  trackEvent('app_started', {
    build_time: __BUILD_TIME__,
    /* Time from navigation to the app's first line of JavaScript. On the web that is network plus
       parse; in the Capacitor app the assets are local, so it is very nearly the webview's own
       start-up cost — and it is the number to watch after a live update swaps the bundle. */
    bootstrap_ms: Math.round(performance.now()),
    locale: document.documentElement.lang || undefined,
    // How the web app is actually being used: an installed PWA behaves (and fails) differently
    // from a browser tab, and the two are indistinguishable in the logs otherwise.
    standalone: !isNative && window.matchMedia('(display-mode: standalone)').matches,
    online: navigator.onLine,
  });
}
