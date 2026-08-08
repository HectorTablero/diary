import { captureError, trackEvent } from '@/lib/telemetry';
import { db } from './db';

/* Opening the database, and watching how much room is left in it.
 *
 * Separate from db.ts on purpose. db.ts is imported by the node-environment `logic` tests directly
 * (db.test.ts mocks nothing at all), so what it may import is constrained by what survives outside
 * a browser. Telemetry reaches lib/preferences.ts and lib/apiClient.ts; keeping that dependency
 * here rather than there means the store's schema stays importable from anywhere, and only the
 * bootstrap path pays for the reporting.
 *
 * Everything in this file is best-effort. A telemetry call that threw during boot would be a
 * strictly worse failure than the one it is trying to describe. */

/** Report storage pressure from this fraction of the quota upwards. */
const PRESSURE_THRESHOLD = 0.8;

/**
 * Whether a thrown value is the browser saying "no more room".
 *
 * Two spellings, because there is no single one. Chromium and Firefox throw a `DOMException` named
 * `QuotaExceededError`; Dexie wraps failures from inside a transaction in its own error class,
 * which keeps the original as `.inner` and names itself `QuotaExceededError` too. Safari has
 * historically thrown a plain `Error` whose message is the only clue. Matching on the name and
 * falling back to the message covers all three without needing to know which engine is running.
 */
export function isQuotaError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { name, message, inner } = err as { name?: string; message?: string; inner?: unknown };
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (typeof message === 'string' && /quota|storage is full/i.test(message)) return true;
  return inner !== undefined && inner !== err && isQuotaError(inner);
}

/**
 * How full the origin's storage is, or `null` where the browser won't say.
 *
 * `navigator.storage.estimate()` is deliberately imprecise — it is padded to avoid becoming a
 * cross-origin side channel — which is exactly the right precision for this. The question being
 * asked is "is this device close to the edge", not "how many bytes".
 */
async function measureStorage(): Promise<Record<string, number> | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota) return null;
    const usage = estimate.usage ?? 0;
    return {
      quota_mb: Math.round(estimate.quota / 1024 / 1024),
      usage_mb: Math.round(usage / 1024 / 1024),
      usage_pct: Math.round((usage / estimate.quota) * 100),
    };
  } catch {
    return null; // unsupported, or blocked by a privacy setting
  }
}

let pressureReported = false;

/**
 * Report crossing the storage threshold, at most once per session.
 *
 * Once, because there is nothing a second identical row adds: the app cannot free space on the
 * user's behalf, so this is a signal for whoever is reading the logs rather than something to
 * track over time within one session. It is checked at boot and again after a reset pull, which is
 * the largest single write the app ever makes and therefore the most likely to be the one that
 * tips a device over.
 */
export async function checkStoragePressure(): Promise<void> {
  if (pressureReported) return;
  const storage = await measureStorage();
  if (!storage || storage.usage_pct < PRESSURE_THRESHOLD * 100) return;
  pressureReported = true;
  trackEvent('storage_pressure', storage);
}

/**
 * Open the database explicitly at boot, and say so if it fails.
 *
 * Until now nothing called `db.open()`. Dexie opens lazily on the first table operation, which in
 * practice was `refreshPending()` inside `initSync()` — and that call is `void`-ed, so a database
 * that could not be opened surfaced as an unhandled rejection attributed to whatever query happened
 * to run first, if it surfaced at all. Opening here makes the failure a fact with a name attached,
 * and the names matter because each one is a different problem:
 *
 *   - `VersionError`    — the user has a *newer* build open in another tab. Nothing to fix; the
 *                         other tab wins and this one is read-only until reloaded.
 *   - `UpgradeError`    — a schema migration in db.ts threw. This is our bug, and it locks the user
 *                         out of their whole diary until it is shipped a fix.
 *   - `InvalidStateError` — Firefox private browsing, where IndexedDB exists but refuses to open.
 *                         A whole browsing mode in which this app cannot store anything.
 *   - `QuotaExceededError` — no room even to open.
 *
 * Awaited by no one: this returns a promise the caller drops. The open is *initiated* first, which
 * is all that matters — every later query queues behind Dexie's own open promise — and blocking
 * first paint on a telemetry call would be paying for the report with the thing being measured.
 */
export async function initDb(): Promise<void> {
  /* Both of these are *additional* subscribers, not replacements. Dexie registers its own handler
     for each in its constructor, and `Events.subscribe` pushes onto a list rather than overwriting
     — so the default behaviour is untouched. That is load-bearing for `versionchange`, whose
     default closes this connection so the other tab's upgrade can proceed; suppressing it would
     deadlock the tab that is trying to migrate.

     `blocked`: another tab holds the old schema open while this one wants to upgrade. Dexie stalls
     rather than failing, so without this the app waits at boot with no error anywhere — the only
     failure here that shows a blank screen rather than a message. */
  db.on('blocked', () => trackEvent('db_blocked'));
  /* The reverse: another tab upgraded past us, Dexie closes this connection, and every query from
     here on rejects. The app is broken until reload, and nothing else would say so. */
  db.on('versionchange', () => trackEvent('db_version_change'));

  try {
    await db.open();
  } catch (err) {
    const { name } = err as { name?: string };
    captureError(err, {
      scope: 'db.open',
      error_name: name,
      quota: isQuotaError(err),
      // Firefox private browsing: IndexedDB is present and refuses to open. Worth separating from
      // a genuine fault, because it is a supported browser configuration rather than a bug.
      private_mode: name === 'InvalidStateError',
    });
    return;
  }

  const storage = await measureStorage();
  trackEvent('db_opened', { version: db.verno, ...storage });
  await checkStoragePressure();
}
