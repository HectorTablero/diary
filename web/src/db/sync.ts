import type { BatchResponse, SyncCollection, SyncResponse } from '@diary/shared';
import { BATCH_OP_PATH_REGEX } from '@diary/shared';
import { API_BASE, CLIENT_ID, api, ApiError, apiGet } from '@/lib/apiClient';
import { isMeteredConnection } from '@/lib/network';
import { getPreferences, subscribePreferences } from '@/lib/preferences';
import { getCachedUser } from '@/lib/sessionCache';
import { captureError, sampled, trackEvent } from '@/lib/telemetry';
import {
  bumpLookupVersion,
  db,
  entryFromDto,
  getMeta,
  personFromDto,
  setMeta,
  type OutboxOp,
} from './db';
import {
  documentBasePushed,
  documentWritePrecondition,
  reconcilePluginDocuments,
  type MergedDocumentWrite,
} from './pluginDocumentMerge';
import { checkStoragePressure } from './storage';

/* Sync engine: replays the outbox against the REST API in order (push), then
   pulls everything changed since the last cursor. Pull only runs after a fully
   drained outbox, so server state can never clobber unpushed local edits. */

/**
 * Why sync isn't getting through right now, or `null` when nothing is in the way.
 *
 * Three separate answers rather than one `offline` flag, because they need three different things
 * from the user and only one of them is "wait":
 *
 *  - `offline`     — this device has no network. Nothing to do but wait.
 *  - `unreachable` — the network is up but the server isn't answering (it's down, or a captive
 *                    portal is eating the request). navigator.onLine cannot see this, which is
 *                    why the reconnect probe exists.
 *  - `paused`      — nothing is broken at all. "Sync on Wi-Fi only" is on and this is a metered
 *                    connection, so the app is holding writes back *on purpose*. This one has a
 *                    way out, and the UI offers it: sync anyway.
 */
export type SyncBlocker = 'offline' | 'unreachable' | 'paused' | null;

export interface SyncStatus {
  pending: number;
  syncing: boolean;
  blocker: SyncBlocker;
  /** The server rejected our session — data stays local until the user signs in again. */
  needsAuth: boolean;
  lastSyncAt: string | null;
}

let status: SyncStatus = {
  pending: 0,
  syncing: false,
  blocker: navigator.onLine ? null : 'offline',
  needsAuth: false,
  lastSyncAt: null,
};

/** A failed request means "no network" or "server's not there" depending on this, and nothing
    else can tell the two apart. */
const networkBlocker = (): SyncBlocker => (navigator.onLine ? 'unreachable' : 'offline');

const statusListeners = new Set<() => void>();
const dataListeners = new Set<() => void>();

/* Telemetry for this module reports *transitions and incidents*, never states.
 *
 * Everything in here runs on a loop — a kick fires on every mutation, every foreground, every
 * reconnect and every sixty seconds regardless — so an event per pass describing an unchanged
 * situation would be thousands of identical rows a day per device, saying only that someone's
 * phone is still on a train. What is worth a row is the moment the situation changed, and the
 * gap between two of those is the duration, which the query can work out for itself. */

/** Epoch ms at which the current blocker began; 0 when there isn't one. */
let blockerSince = 0;

function reportStatusChange(before: SyncStatus, after: SyncStatus): void {
  /* `offline` is excluded in both directions. It is the normal condition of an offline-first app
     rather than a fault, it is the one blocker the user can already see and explain, and on a
     phone it would be the single noisiest event in the whole system. `unreachable` and `paused`
     are the interesting ones: the first means the server is down or a captive portal is eating
     requests, and the second means the app is holding writes back on a setting the user may have
     forgotten turning on. */
  if (before.blocker !== after.blocker) {
    const now = Date.now();
    if (before.blocker && before.blocker !== 'offline') {
      trackEvent('sync_unblocked', {
        blocker: before.blocker,
        blocked_ms: blockerSince ? now - blockerSince : undefined,
        pending: after.pending,
      });
    }
    if (after.blocker && after.blocker !== 'offline') {
      trackEvent('sync_blocked', { blocker: after.blocker, pending: after.pending });
    }
    blockerSince = after.blocker ? now : 0;
  }

  /* The quietest serious failure in the app: the session is gone, every write from here on stays
     on the device, and nothing else in this file will ever say so again — `needsAuth` is set once
     and then simply stays true. If this starts appearing across many clients at once it is a
     server-side auth regression, and it would otherwise be visible only as sync traffic stopping. */
  if (!before.needsAuth && after.needsAuth) {
    trackEvent('sync_auth_lost', { pending: after.pending });
  }
}

function setStatus(patch: Partial<SyncStatus>) {
  const before = status;
  status = { ...status, ...patch };
  reportStatusChange(before, status);
  statusListeners.forEach((cb) => cb());
}

export const getSyncStatus = (): SyncStatus => status;

export function subscribeSyncStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

/**
 * Resolve once the outbox has emptied, or once it is clear it won't.
 *
 * For the one flow that has to *wait* for the network rather than merely tolerate it: restoring a
 * backup. Everything else in this app is deliberately fire-and-forget — you write, it saves
 * locally, it syncs when it can — but a restore is different in two ways. It can queue thousands of
 * writes at once, and it is the one action a user takes precisely because they are worried about
 * losing data, so leaving the page while it is still going and being told nothing is the wrong
 * shape entirely.
 *
 * `blocked` rather than an error when the network gives out: the writes are safe in the outbox and
 * will replay, so the honest report is "this will finish later", not "this failed". The timeout is
 * the third case — a queue that is neither draining nor blocked, which shouldn't happen and must
 * still not hang a button forever.
 *
 * The timeout measures *stillness*, not the whole wait: it restarts every time the queue shrinks.
 * It used to cap the wait outright, and a large restore against a slow server — steadily draining,
 * every batch answered — outlived it, so the page gave up midway, said the upload would finish
 * "once you are back online" on a perfectly good connection, and then said nothing at all when it
 * did finish. Only a queue that has stopped moving is a queue worth giving up on.
 */
export async function waitForOutboxDrain(idleTimeoutMs = 120_000): Promise<'drained' | 'blocked'> {
  /* Counted from the table, never from `status.pending`. That figure is a snapshot refreshed during
     a sync pass, so immediately after a big enqueue it still reads whatever it read before — and a
     caller that trusted it would be told a queue of several thousand writes had drained, instantly,
     before a single one had been sent. The status is right about *blockers*, which is what it is
     consulted for below; it is merely stale about the count. */
  let lowest = await db.outbox.count();
  if (lowest === 0) return 'drained';

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (result: 'drained' | 'blocked') => {
      if (settled) return; // the count is read asynchronously, so checks can overlap
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(result);
    };
    const idle = () => setTimeout(() => finish('blocked'), idleTimeoutMs);
    let timer = idle();

    const check = () => {
      void (async () => {
        const remaining = await db.outbox.count();
        if (settled) return;
        if (remaining < lowest) {
          // Progress: the clock only runs while nothing is moving.
          lowest = remaining;
          clearTimeout(timer);
          timer = idle();
        }
        if (remaining === 0) {
          finish('drained');
          return;
        }
        /* A blocker means the queue has stopped moving for a reason the user can act on (or wait
           out); either way there is nothing left for this promise to wait for.

           But only once no pass is running. A blocker is cleared by nothing short of a completed
           pull, which comes after the whole queue has drained, so during a pass it is the previous
           pass's verdict rather than this one's: an "unreachable" left by a failure an hour ago,
           or a "paused" set by the Wi-Fi-only check of a timer kick that arrived while a forced
           upload was going fine. Either ended this wait on the first batch, with the upload still
           running. A pass that really is blocked ends, and its last status change lands here. */
        const { blocker, needsAuth, syncing } = getSyncStatus();
        if ((blocker || needsAuth) && !syncing) finish('blocked');
      })();
    };

    unsubscribe = subscribeSyncStatus(check);
    check(); // in case it drained between the count above and the subscription
  });
}

/** Fires after a pull applied server changes locally (used to refresh queries). */
export function onSyncApplied(cb: () => void): () => void {
  dataListeners.add(cb);
  return () => dataListeners.delete(cb);
}

const reconnectListeners = new Set<() => void>();

/** Fires when the server becomes reachable again after a failed sync. */
export function onReconnected(cb: () => void): () => void {
  reconnectListeners.add(cb);
  return () => reconnectListeners.delete(cb);
}

const mergeListeners = new Set<(conflicts: number) => void>();

/**
 * Fires when a pull merged two devices' edits and had to keep both versions of something.
 *
 * Only for the conflicted case. A clean merge is the machinery doing its job and is not worth
 * interrupting anyone over — the document simply contains both people's work, which is what they
 * would each have expected. A *conflict* has left a duplicated sentence in someone's prose, and
 * they need to know it is there so they can delete the half they don't want.
 *
 * A listener rather than a toast from in here, for the same reason as onRejected below: this module
 * knows nothing about i18n or the toaster. main.tsx wires it up.
 */
export function onDocumentsMerged(cb: (conflicts: number) => void): () => void {
  mergeListeners.add(cb);
  return () => mergeListeners.delete(cb);
}

const rejectionListeners = new Set<(count: number) => void>();

/**
 * Fires once per push pass in which the server refused one or more writes outright.
 *
 * A listener rather than a toast from in here: this module deliberately knows nothing about i18n
 * or the toaster, the same way `onReconnected` doesn't. main.tsx wires both up.
 */
export function onRejected(cb: (count: number) => void): () => void {
  rejectionListeners.add(cb);
  return () => rejectionListeners.delete(cb);
}

async function refreshPending() {
  setStatus({ pending: await db.outbox.count() });
}

/* Outbox paths carry document ids — `/people/<id>/events/<id>/asked` — and an id is both the
   user's own data and the thing that would turn one chart into a thousand single-row series. The
   shape is what a question about rejected writes is actually about, so every segment that isn't
   part of the route template becomes `:id`. An allow-list rather than a pattern match, because the
   ids are generated in more than one place and nothing guarantees they keep looking alike. */
const ROUTE_SEGMENTS = new Set([
  'entries',
  'people',
  'tags',
  'threads',
  // The route is flat (/plugin-records/:id) rather than /plugins/:pluginId/records, so that
  // dirtyIds below still finds the document id in the second segment. The pluginId travels in the
  // body; it is deliberately not part of the shape, being far higher cardinality than a route.
  'plugin-records',
  'plugin-documents',
  'settings',
  'sync',
  'checkup',
  'events',
  'asked',
  'said',
  'order',
]);

const routeShape = (path: string): string =>
  path
    .split('/')
    .map((segment) => (segment === '' || ROUTE_SEGMENTS.has(segment) ? segment : ':id'))
    .join('/');

/** Ids touched by still-queued ops; pull must not overwrite or delete them. */
async function dirtyIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const op of await db.outbox.toArray()) {
    const body = op.body as { id?: string } | undefined;
    if (body?.id) ids.add(body.id);
    const segments = op.path.split('/').filter(Boolean); // e.g. entries/<id>/said/<personId>
    if (segments[1]) ids.add(segments[1]);
  }
  return ids;
}

/**
 * How many ops one push request carries: sized by how long a request takes, not fixed.
 *
 * The server's cost is per op either way, so a bigger batch saves only round trips. What a smaller
 * one buys is a queue that visibly moves: the remaining count is published after every batch (see
 * pushOutbox), and that is what the backup importer's progress bar reads. A fixed count can only
 * get that right for one server speed. It was a hundred, which against a server spending a few
 * hundred milliseconds per write — a remote database, a large diary, overwrites rather than
 * creates — meant half a minute and more between steps, and a bar that read as stuck.
 *
 * So each batch is sized to take about PUSH_BATCH_TARGET_MS at the per-op pace the last one
 * actually ran at: a fast server gets big batches and few round trips, a slow one small batches
 * and a bar that still moves every second or so. It starts small so the first step lands quickly,
 * at most doubles per batch so one lucky answer cannot commit the next request to minutes of
 * work, and is kept across passes — it describes the server, and the server has not changed.
 */
const PUSH_BATCH_MIN_OPS = 10;
const PUSH_BATCH_MAX_OPS = 200;
const PUSH_BATCH_TARGET_MS = 1_000;
let pushBatchOps = 25;

function adaptBatchSize(sent: number, elapsedMs: number): void {
  // Only a full batch says anything about the pace: a short one is just the end of the queue.
  if (sent < pushBatchOps) return;
  const perOpMs = Math.max(elapsedMs, 1) / sent;
  const fit = Math.floor(PUSH_BATCH_TARGET_MS / perOpMs);
  pushBatchOps = Math.min(PUSH_BATCH_MAX_OPS, pushBatchOps * 2, Math.max(PUSH_BATCH_MIN_OPS, fit));
}

/** A queued op as it will actually be sent. */
interface PreparedOp {
  op: OutboxOp;
  payload: unknown;
  bodyWrite: { id: string; body: string } | null;
  precondition: string | undefined;
}

/** What the server answered for one op — the same either way it was sent. */
type OpOutcome = { ok: true; response: unknown } | { ok: false; error: ApiError };

async function prepare(op: OutboxOp): Promise<PreparedOp> {
  /* The one op in the queue that is not sent exactly as it was written down: a document's body is
     the whole text, so it goes up as a compare-and-swap against the version this device last saw.
     The precondition is read now rather than baked in at enqueue time — see
     documentWritePrecondition for why that distinction is the difference between the guard
     working and the guard refusing every write after the first. */
  const bodyWrite = documentBodyWrite(op);
  const precondition = bodyWrite ? await documentWritePrecondition(bodyWrite.id) : undefined;
  const payload =
    bodyWrite && precondition ? { ...(op.body as object), baseVersion: precondition } : op.body;
  return { op, payload, bodyWrite, precondition };
}

/**
 * The next ops to send, oldest first: as many as one batch carries, cut short where it must be.
 *
 * Before a second body write to a document already in the batch, because that write's precondition
 * is the version the first one will come back stamped with, which nobody knows until it has been
 * sent. And before any op whose path the batch endpoint does not accept, which then goes alone —
 * that is the only way it ever went before, so nothing it relies on changes.
 */
async function nextBatch(limit: number): Promise<PreparedOp[]> {
  const queued = await db.outbox.orderBy('seq').limit(limit).toArray();
  const batch: PreparedOp[] = [];
  const bodyWritten = new Set<string>();
  for (const op of queued) {
    if (!BATCH_OP_PATH_REGEX.test(op.path)) {
      if (!batch.length) batch.push(await prepare(op));
      break;
    }
    const bodyWrite = documentBodyWrite(op);
    if (bodyWrite) {
      if (bodyWritten.has(bodyWrite.id)) break;
      bodyWritten.add(bodyWrite.id);
    }
    batch.push(await prepare(op));
  }
  return batch;
}

async function sendOne({ op, payload }: PreparedOp): Promise<OpOutcome> {
  try {
    const response = await api<unknown>(op.path, {
      method: op.method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { ok: true, response };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return { ok: false, error: err };
  }
}

/**
 * Send several ops in one request, and read back what each would have answered on its own.
 *
 * The server replays them through the whole app one at a time (server/src/routes/batch.ts), so each
 * result is the status and body that op's own request would have got — and is turned back into the
 * same success or `ApiError` that `api()` makes of a response, so settle() cannot tell the two
 * paths apart. The server attempts every op whatever came before it; fewer results than ops means
 * only that the request was abandoned partway, and the rest were never attempted.
 *
 * `null` when the server refused the envelope itself, with a 4xx. That says nothing about the ops
 * inside it — it is a server that predates /batch (404), or one that will not take this envelope —
 * and nothing in it was applied, so the caller sends them the way every server understands: alone.
 */
async function sendBatch(batch: PreparedOp[]): Promise<OpOutcome[] | null> {
  let results: BatchResponse['results'];
  try {
    ({ results } = await api<BatchResponse>('/batch', {
      method: 'POST',
      body: JSON.stringify({
        ops: batch.map(({ op, payload }) => ({ method: op.method, path: op.path, body: payload })),
      }),
    }));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    // No network, no session, or a server in trouble: exactly what the first op alone would have
    // run into, and settle() stops the drain on each of them without touching the op.
    if (err.status === 0 || err.status === 401 || err.status >= 500) {
      return [{ ok: false, error: err }];
    }
    trackEvent('sync_batch_refused', { status: err.status, code: err.code });
    return null;
  }
  // Only reachable if the server gave up before the first op (it saw the request abandoned). Read
  // as a server in trouble, so the drain stops and retries rather than spinning on the same batch.
  if (!results.length) return [{ ok: false, error: new ApiError(503, 'errors.unknown') }];
  return results.slice(0, batch.length).map(({ status, body }) => {
    if (status >= 200 && status < 300) return { ok: true, response: body };
    const code = (body as { error?: unknown } | null)?.error;
    return {
      ok: false,
      error: new ApiError(status, typeof code === 'string' && code ? code : 'errors.unknown'),
    };
  });
}

/**
 * Apply the server's answer to one op. Returns false when the queue is blocked and the drain must
 * stop here — with this op, and everything after it, still queued.
 */
async function settle(
  { op, bodyWrite, precondition }: PreparedOp,
  outcome: OpOutcome,
): Promise<boolean> {
  if (outcome.ok) {
    /* The server has our text now, so the ancestor moves onto it — and onto the version the
       server just stamped, which is what the *next* write has to match.

       Only when a precondition was actually sent. Without one there was no base record, and the
       op is something else that happens to carry a string `body`: a *revision*, whose body is an
       encoded patch and which has no ancestor to track. Writing one here would leave a base
       behind that sent every future pull of that revision through the merge path. */
    if (bodyWrite && precondition) {
      const version = (outcome.response as { updatedAt?: unknown } | null)?.updatedAt;
      if (typeof version === 'string') {
        await documentBasePushed(bodyWrite.id, bodyWrite.body, version);
      }
    }
    await db.outbox.delete(op.seq!);
    pushedThisPass++;
    return true;
  }
  const err = outcome.error;
  if (err.status === 0) {
    setStatus({ blocker: networkBlocker() });
    networkFailure = true;
    return false;
  }
  if (err.status === 401) {
    setStatus({ needsAuth: true });
    return false;
  }
  if (err.status >= 500) {
    setStatus({ blocker: 'unreachable' });
    networkFailure = true;
    return false; // server hiccup: retry once it answers again
  }
  /* A conditional body write the server refused because the row moved underneath it — the
     non-fast-forward push, and the whole point of `baseVersion` (see the shared update schema).
     The op leaves the queue and nothing is lost: the text is still in Dexie, the merge base is
     still recorded, and the pull that follows this drained queue will merge the two versions
     and enqueue the result. Retrying the op as-is would only be refused again, forever, and
     dead-lettering it would report data loss for a write the app is about to redo properly. */
  if (err.status === 409 && bodyWrite && precondition) {
    await db.outbox.delete(op.seq!);
    // Sampled: a document edited on two devices produces a burst of these, and the rate is the
    // signal. The merge that follows is counted in full, in pull().
    if (sampled(0.1)) trackEvent('sync_stale_write', { path: routeShape(op.path) });
    return true;
  }
  if (err.status === 409 && op.method === 'POST') {
    await removeLocalDoc(op);
    await db.outbox.delete(op.seq!);
    /* Tolerated, so nothing else records it — but a replayed create and a *lost name race* both
       arrive here and only the second one destroys a local document. Sampled because a flaky
       connection replays whole batches of these at once, and one in ten is plenty to notice
       that the rate has changed. */
    if (sampled(0.1)) trackEvent('sync_conflict', { path: routeShape(op.path) });
    return true;
  }
  /* Already gone is not a loss.
     For everything but a create that is unconditional: a PATCH or DELETE against a document
     the server no longer has asks for a state it is already in.
     For a create it takes `tolerate404`, which only the backup importer sets — a restore of an
     old file legitimately posts things whose parent has since been deleted, and reporting those
     as unsaved changes would be reporting data loss for data that was deleted on purpose. Every
     other POST 404 is a real loss and falls through to the dead letter below. */
  if (err.status === 404 && (op.method !== 'POST' || op.tolerate404)) {
    await db.outbox.delete(op.seq!);
    // Sampled, so a restore quietly dropping *everything* — a wrong base URL, an API that moved
    // — is still visible as a rate rather than vanishing into a tolerated branch.
    if (op.tolerate404 && sampled(0.1)) {
      trackEvent('sync_tolerated_404', { path: routeShape(op.path) });
    }
    return true;
  }
  /* Any other 4xx would jam the queue forever, so it has to leave the queue — but it must not
     leave without a trace. The local copy of this change still says "saved", and only the
     dead-letter row and the toast that follows it stop the user finding out on another device
     months later, or not at all. */
  console.warn('sync: rejected op moved to dead letter', op, err.code);
  /* Never sampled. This is a write the user was told had been saved and which the server threw
     away — the single most serious thing that happens in this app that isn't a crash. Until
     now the only traces were a console.warn nobody reads and a toast that is gone in seconds,
     which means a systematic rejection (a payload the API stopped accepting after a deploy,
     say) would be silently eating every affected write on every client with nothing anywhere
     to show for it. `code` is the server's i18n key, which is what makes these groupable into
     "the same bug" rather than a list of incidents. */
  trackEvent('sync_dead_letter', {
    status: err.status,
    code: err.code,
    method: op.method,
    path: routeShape(op.path),
  });
  await db.deadLetter.add({
    method: op.method,
    path: op.path,
    body: op.body,
    status: err.status,
    code: err.code,
    failedAt: new Date().toISOString(),
  });
  await db.outbox.delete(op.seq!);
  rejectedThisPass++;
  return true;
}

/**
 * Replay queued ops in order. Returns true when the queue fully drained.
 * Tolerance rules keep replays idempotent: a 404 on DELETE/PATCH/PUT means the
 * doc is already gone; a 409 on POST means the create already applied (or lost
 * a name race) — drop the op and let the pull reconcile.
 *
 * Ops go up in batches where they can — a backup restore or a contacts import queues hundreds, and
 * a round trip each was most of what it cost — but every op is still answered, and settled here,
 * one at a time and in order, exactly as it would have been sent alone. A lone op is sent alone.
 *
 * The server carries on past a failure, so when settling stops on one (a 5xx), the ops behind it in
 * the same batch may already have landed. They stay queued anyway and go up again after it: the
 * failed op keeps its place ahead of them, and replaying a write that already applied is the case
 * the tolerance rules above exist for — it is what a response lost in flight has always produced.
 */
async function pushOutbox(): Promise<boolean> {
  /* Per pass, not per session: a server refusing batches costs one refused request per pass rather
     than one per op, and a server upgraded mid-session starts getting batches on the next pass. */
  let batching = true;
  for (;;) {
    const batch = await nextBatch(batching ? pushBatchOps : 1);
    if (!batch.length) return true;
    let outcomes: OpOutcome[] | null;
    if (batch.length === 1) {
      outcomes = [await sendOne(batch[0]!)];
    } else {
      const sentAt = performance.now();
      outcomes = await sendBatch(batch);
      // Only an answered batch: a refused or failed one says nothing about how fast ops apply.
      if (outcomes && outcomes.length === batch.length) {
        adaptBatchSize(batch.length, performance.now() - sentAt);
      }
    }
    if (!outcomes) {
      batching = false;
      continue;
    }
    for (const [i, outcome] of outcomes.entries()) {
      if (!(await settle(batch[i]!, outcome))) return false;
    }
    // Live, not just at the end of the pass: anything showing how far a long drain has got (the
    // backup importer's progress bar, the sync pill's count) moves as each batch lands.
    await refreshPending();
  }
}

/* Dead letters are the only trace of a write the server refused, so they are kept — but the table
   is otherwise emptied by nothing short of a sign-out, and both of these bounds close a different
   way for it to grow without end. Age: a rejection from last spring has long since been reported
   and acted on or forgotten, and keeping it can only make the next report harder to read. Count: a
   write the server rejects *systematically* — a client version the API no longer accepts, say —
   produces one of these per attempt, indefinitely, and that one is a disk-filling loop rather than
   a slow accumulation. */
const DEAD_LETTER_MAX = 200;
const DEAD_LETTER_MAX_AGE_MS = 90 * 86_400_000;

async function trimDeadLetter(): Promise<void> {
  const cutoff = new Date(Date.now() - DEAD_LETTER_MAX_AGE_MS).toISOString();
  // `failedAt` is indexed and holds ISO strings, which sort lexicographically in date order.
  await db.deadLetter.where('failedAt').below(cutoff).delete();
  const excess = (await db.deadLetter.count()) - DEAD_LETTER_MAX;
  if (excess <= 0) return;
  const oldest = await db.deadLetter.orderBy('failedAt').limit(excess).primaryKeys();
  await db.deadLetter.bulkDelete(oldest);
}

/** The document id and text of an op that rewrites a document's body, or null for anything else. */
function documentBodyWrite(op: OutboxOp): { id: string; body: string } | null {
  if (op.method !== 'PATCH' || !op.path.startsWith('/plugin-documents/')) return null;
  const body = (op.body as { body?: unknown } | undefined)?.body;
  if (typeof body !== 'string') return null;
  return { id: op.path.slice('/plugin-documents/'.length), body };
}

/** A conflicted local create is a phantom (never made it to the server): remove it. */
async function removeLocalDoc(op: OutboxOp) {
  const id = (op.body as { id?: string } | undefined)?.id;
  if (!id) return;
  if (op.path.startsWith('/entries')) await db.entries.delete(id);
  else if (op.path.startsWith('/people')) await db.people.delete(id);
  else if (op.path.startsWith('/tags')) await db.tags.delete(id);
  else if (op.path.startsWith('/threads')) await db.threads.delete(id);
  else if (op.path.startsWith('/plugin-records')) await db.pluginRecords.delete(id);
  /* Reached far more often than the others, and not only by the offline-enable race they exist for:
     two devices writing the same document on the same day collide on the unique revision index, and
     this is what drops the loser's phantom row so the pull can hand it the winner. */
  else if (op.path.startsWith('/plugin-documents')) await db.pluginDocuments.delete(id);
}

/* Live channel: a WebSocket per open client. The server nudges the user's
   other devices after every mutation, so edits appear everywhere within
   moments while the diary is open on several devices. */

let liveSocket: WebSocket | null = null;
let liveConnecting = false;
/** Sockets opened this session — a reconnect counter, not a gauge. */
let liveOpens = 0;

function ensureLiveChannel(): void {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
  if (!navigator.onLine || liveConnecting) return;
  if (liveSocket && liveSocket.readyState <= WebSocket.OPEN) return; // connecting or open
  liveConnecting = true;
  void (async () => {
    try {
      // The session token must never appear in a URL (URLs land in access
      // logs); redeem a single-use short-lived ticket over normal auth instead.
      const { ticket } = await apiGet<{ ticket: string }>('/sync/ws-ticket');
      const base = API_BASE || window.location.origin;
      const params = new URLSearchParams({ ticket, client: CLIENT_ID });
      const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/api/sync/ws?${params}`);
      socket.onopen = () => {
        /* Sampled: a phone switching networks reopens this all day, and the rate is the signal
           rather than any individual open. `attempt` is what makes a reconnect *loop* — a socket
           the server accepts and drops every ten seconds — visible as a rising number rather than
           as a flat stream of identical rows. */
        liveOpens++;
        if (sampled(0.05)) trackEvent('live_channel_open', { attempt: liveOpens });
      };
      socket.onmessage = (event) => {
        if (event.data === 'changed') kick('live');
      };
      socket.onclose = () => {
        if (liveSocket === socket) liveSocket = null;
        // Gentle retry; kick()/interval also re-open it on their own triggers.
        setTimeout(ensureLiveChannel, 10_000);
      };
      socket.onerror = () => socket.close();
      liveSocket = socket;
    } catch (err) {
      liveSocket = null; // not signed in yet or offline; later triggers retry
      /* Only when the network was up. Offline, the ticket request fails by definition and the
         retry above is the whole design; online it means the ticket endpoint refused us, which is
         a session or a server problem and the reason live sync would be silently dead while
         everything else looks fine. */
      if (navigator.onLine && sampled(0.2)) {
        trackEvent('live_channel_failed', {
          code: err instanceof ApiError ? `${err.status}:${err.code}` : 'exception',
        });
      }
    } finally {
      liveConnecting = false;
    }
  })();
}

/** Used on sign-out so a dead session doesn't keep a socket around. */
export function closeLiveChannel(): void {
  liveSocket?.close();
  liveSocket = null;
}

/* Reconnect probe: after a sync fails on network grounds, ping /api/health
   every few seconds (navigator.onLine can't see an unreachable server). The
   moment it answers, announce it and sync. */

const PROBE_INTERVAL_MS = 10_000;
let probeTimer: ReturnType<typeof setInterval> | null = null;

function stopReconnectProbe() {
  if (probeTimer !== null) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
}

function startReconnectProbe() {
  if (probeTimer !== null) return;
  probeTimer = setInterval(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${API_BASE}/api/health`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return;
    } catch {
      return; // still unreachable
    }
    stopReconnectProbe();
    setStatus({ blocker: null });
    reconnectListeners.forEach((cb) => cb());
    kick('probe');
  }, PROBE_INTERVAL_MS);
}

/* The three operations a pull performs on a synced table, and no more. Dexie's own EntityTable
   types don't unify into one Record — each carries its own row shape, and their insert types differ
   over whether `id` is optional — so a structural type is what lets the four be addressed by
   collection name. Being the narrowest one that compiles is the point: nothing reached through here
   can write. */
interface SyncTable {
  delete: (key: string) => Promise<void>;
  bulkDelete: (keys: string[]) => Promise<void>;
  toCollection: () => { primaryKeys: () => Promise<string[]> };
}

/** What one pull actually did, for the pass event assembled in run(). */
interface PullSummary {
  reset: boolean;
  received: number;
  deletions: number;
  /** Docs the reset branch removed because the full state didn't name them. */
  orphaned: number;
  /** Server changes discarded because an unpushed local edit outranked them. */
  dirtySkipped: number;
  applied: boolean;
  fetchMs: number;
}

async function pull(): Promise<PullSummary> {
  const since = await getMeta<string>('syncCursor');
  const fetchStartedAt = performance.now();
  const res = await apiGet<SyncResponse>(
    `/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`,
  );
  const fetchMs = Math.round(performance.now() - fetchStartedAt);

  const threads = res.threads ?? []; // tolerates a server that predates threads (stale deploy)
  const pluginRecords = res.pluginRecords ?? []; // ditto — see `acknowledged` below
  const pluginDocuments = res.pluginDocuments ?? []; // ditto
  /* Whether this response is the whole server state rather than a delta — see SyncResponse.reset.
     The `?? !since` mirrors the threads line above for a server that predates the field: without a
     cursor the client can reach the same conclusion on its own, and that is the only case where it
     safely can. With a cursor it must assume a delta, which is exactly how it behaved before. */
  const reset = res.reset ?? !since;

  /* Ids the server sent back as *alive* in this very response, per collection.
     A doc is only in a pull if the server still had it when the query ran, so a tombstone naming
     one of these is describing a doc that exists again — an undo re-created it under its original
     id. The server normally retracts such a tombstone on the re-create (clearDeletions), so this
     is the belt to that braces: it also covers the moment between the re-create committing and its
     tombstone being cleared (the two pull queries run concurrently and can straddle it), and any
     client still talking to a server from before that change.

     Presence, not timestamps, decides it: TagDto carries no updatedAt to compare, and "the server
     still has it" is the stronger statement anyway. The one case this reads too generously — a doc
     deleted *while* this pull was running, so the entry query saw it alive and the deletion query
     saw its tombstone — heals on the next pull, where the cursor overlap re-sends the tombstone and
     the doc is genuinely absent. */
  const alive: Record<SyncCollection, Set<string>> = {
    entry: new Set(res.entries.map((e) => e.id)),
    person: new Set(res.people.map((p) => p.id)),
    tag: new Set(res.tags.map((t) => t.id)),
    thread: new Set(threads.map((t) => t.id)),
    pluginRecord: new Set(pluginRecords.map((r) => r.id)),
    pluginDocument: new Set(pluginDocuments.map((d) => d.id)),
  };

  /* Which collections this response actually *spoke about*, as opposed to spoke about and had
     nothing to say.

     The reset branch below deletes every local id the response did not name, so those two cases
     must not be conflated — and `res.x ?? []` conflates them exactly. A client talking to a server
     from before a collection existed (a staggered deploy, or an Android build that outran the
     server) reads the missing key as an empty array, concludes the account owns none of them, and
     deletes the lot. Nothing about that looks like a failure from either end.

     So absence means "this server cannot speak for that collection", and the sweep skips it. The
     cost of being wrong that way is a locally-deleted row lingering until the next pull from a
     server that does know; the cost of being wrong the other way is the data. */
  const acknowledged = new Set<SyncCollection>(['entry', 'person', 'tag']);
  if (res.threads !== undefined) acknowledged.add('thread');
  if (res.pluginRecords !== undefined) acknowledged.add('pluginRecord');
  if (res.pluginDocuments !== undefined) acknowledged.add('pluginDocument');

  /* db.outbox joins the transaction so `dirty` can be read *inside* it.
     Reading it beforehand left a window: a mutation enqueued between that read and this
     transaction is missing from `dirty`, and — being newer than the response — missing from the
     server's answer too. Under the reset branch below, "in neither" is the definition of a doc to
     delete, so a note written in that instant would be erased by the very sync meant to save it.
     Holding the table for the transaction's duration makes the two reads agree. */
  /* Did this response actually carry anything? Set inside the transaction, read after it.
     Everything downstream of a pull is expensive — the listeners invalidate the whole query cache
     and re-run every read on screen, several of which scan a table — and a poll fires every 60
     seconds whether or not the diary changed. On an idle app that is the entire cost of the app,
     paid over and over to arrive back where it started. */
  let applied = reset;
  let orphaned = 0;
  let dirtySkipped = 0;
  /* Filled inside the transaction, acted on after it — a Dexie transaction may only touch the
     tables it declared, and a merged body has to be queued as well as stored. */
  let mergedWrites: MergedDocumentWrite[] = [];
  let mergeConflicts = 0;

  await db.transaction(
    'rw',
    [
      db.entries,
      db.people,
      db.tags,
      db.threads,
      db.pluginRecords,
      db.pluginDocuments,
      /* Joined for reconcilePluginDocuments, which reads the merge base for every document row in
         the response and rewrites it when a merge happens. It has to be inside this transaction:
         the base is what stops two devices' prose overwriting each other, and reading it outside
         would leave a window where a keystroke moved it between the read and the write. */
      db.pluginDocumentBases,
      db.outbox,
      db.meta,
    ],
    async () => {
      const dirty = await dirtyIds();
      const clean = <T extends { id: string }>(docs: T[]) => {
        const kept = docs.filter((d) => !dirty.has(d.id));
        dirtySkipped += docs.length - kept.length;
        return kept;
      };

      await db.entries.bulkPut(clean(res.entries).map(entryFromDto));
      await db.people.bulkPut(clean(res.people).map(personFromDto));
      await db.tags.bulkPut(clean(res.tags));
      await db.threads.bulkPut(clean(threads));
      await db.pluginRecords.bulkPut(clean(pluginRecords));
      /* The one collection a pull may not simply overwrite. A document's body is a page of prose in
         a single field, so `bulkPut` here means "whichever device synced last is the one that wrote
         today" — see reconcilePluginDocuments, which merges instead. */
      const reconciled = await reconcilePluginDocuments(clean(pluginDocuments));
      await db.pluginDocuments.bulkPut(reconciled.rows);
      mergedWrites = reconciled.writes;
      mergeConflicts = reconciled.conflicts;
      const tables: Record<SyncCollection, SyncTable> = {
        entry: db.entries,
        person: db.people,
        tag: db.tags,
        thread: db.threads,
        pluginRecord: db.pluginRecords,
        pluginDocument: db.pluginDocuments,
      };
      for (const del of res.deletions) {
        if (dirty.has(del.docId)) {
          dirtySkipped++;
          continue; // an unpushed local edit outranks the server
        }
        if (alive[del.coll]?.has(del.docId)) continue; // re-created since: stale tombstone
        await tables[del.coll]?.delete(del.docId);
        /* A merge base outlives the document it belongs to unless it is dropped with it, and a
           document deleted elsewhere never appears in a pull again, so nothing later would clear
           it. Cheap either way: the table is empty on most devices. */
        if (del.coll === 'pluginDocument') await db.pluginDocumentBases.delete(del.docId);
      }

      /* A reset response carries no tombstones — there are none left to carry — so the deletes it
         has to convey are the ids it simply doesn't mention. `alive` is already that list.

         This runs only under reset, and the distinction is the whole safety of it: a delta names
         only what changed, so treating an unmentioned id as deleted there would wipe the entire
         local database on the first quiet minute. */
      if (reset) {
        // `acknowledged`, not every key of `tables`: a collection this server didn't mention is one
        // it cannot speak for, and "unmentioned" is the delete signal here. See its definition.
        for (const coll of acknowledged) {
          const local = await tables[coll].toCollection().primaryKeys();
          const gone = local.filter((id) => !alive[coll].has(id) && !dirty.has(id));
          orphaned += gone.length;
          await tables[coll].bulkDelete(gone);
          if (coll === 'pluginDocument') await db.pluginDocumentBases.bulkDelete(gone);
        }
      }

      /* Settings come back on every pull regardless of the cursor — the server has no changed-since
         filter for a singleton — so they can't be counted as a change by their presence, the way
         the arrays above can. Comparing is cheap (one small object) and is the only way a
         preference changed on another device still reaches this one promptly. */
      const previous = await getMeta<unknown>('settings');
      if (JSON.stringify(previous) !== JSON.stringify(res.settings)) applied = true;
      await setMeta('settings', res.settings);

      if (
        res.entries.length ||
        res.people.length ||
        res.tags.length ||
        threads.length ||
        pluginRecords.length ||
        pluginDocuments.length ||
        res.deletions.length
      ) {
        applied = true;
      }
      // Tags, people and threads are what repo.ts's join-map cache is built from; entries aren't.
      if (reset || res.people.length || res.tags.length || threads.length) bumpLookupVersion();

      // 10s overlap absorbs clock skew between capture and the queries; upserts are idempotent.
      await setMeta('syncCursor', new Date(Date.parse(res.serverTime) - 10_000).toISOString());
    },
  );
  /* The one place anything is allowed to say the coast is clear, because it is the one place that
     has proof: a pull that got this far exchanged a request and a response with the server. Every
     other "it's probably fine" was removed — see the note above run(). */
  setStatus({ blocker: null, needsAuth: false, lastSyncAt: new Date().toISOString() });
  stopReconnectProbe(); // reached the server through some other trigger

  /* Documents this pull merged rather than overwrote now hold text the server has never seen, so
     they go straight back into the queue. Written here rather than through db/outbox.ts's enqueue:
     that helper reaches i18n and back into this module, and importing it would close a cycle that
     breaks module initialisation. Nothing it adds is wanted anyway — the caches it invalidates hold
     people and tags, and the notification reconcile has nothing to say about a document. The kick
     below is the one part that is. */
  if (mergedWrites.length) {
    await db.outbox.bulkAdd(
      mergedWrites.map(({ id, body }) => ({
        method: 'PATCH' as const,
        path: `/plugin-documents/${id}`,
        body: { body },
      })),
    );
    // This pass is already past its push, so without a kick the merged text would sit in the queue
    // until the next timer tick — a minute of the other device not seeing an answer.
    kick('mutation');
  }
  if (mergeConflicts > 0) {
    const conflicts = mergeConflicts;
    mergeListeners.forEach((cb) => cb(conflicts));
  }
  if (mergedWrites.length) {
    /* Never sampled, and counted rather than merely logged. This is the event that says two devices
       were editing the same document at once and the app put the two versions back together — the
       situation that used to silently lose one of them. A rate that climbs after a release means
       either that people really do write on two devices more than anyone thought, or that something
       in the precondition path has started manufacturing collisions. */
    trackEvent('plugin_document_merged', {
      documents: mergedWrites.length,
      conflicts: mergeConflicts,
    });
  }

  const received =
    res.entries.length +
    res.people.length +
    res.tags.length +
    threads.length +
    pluginRecords.length +
    pluginDocuments.length;

  /* A reset with a cursor is the one branch in this file that deletes local documents the user
     never asked to delete, and it is never sampled.
     `since` present means this was not a first sync: the client had a cursor and the server
     declined to answer it incrementally, so its tombstones had aged out (README: 180 days) or the
     device had been dark longer than that. `orphaned` is how many local documents that decision
     removed, and it is the number that matters — a handful is a device catching up, while a large
     one on a device that syncs weekly is the retention window being wrong, or a bug in the
     server's idea of what still exists. Nothing could see that before this line. */
  /* A reset writes the user's entire diary in one transaction — the largest thing this app ever
     stores — so it is the write most likely to be the one that finds the edge of the quota, and
     the moment just after it is when a device sitting near that edge is worth noticing. */
  if (reset) void checkStoragePressure();

  if (reset && since) {
    trackEvent('sync_reset', {
      cursor_age_ms: Date.now() - Date.parse(since),
      received,
      orphaned,
      dirty_skipped: dirtySkipped,
      fetch_ms: fetchMs,
    });
  }
  /* Only when something arrived. The status above is unconditional on purpose — it is a statement
     about reachability, which a successful empty pull proves as well as a full one — but the
     listeners are a statement about *data*, and an empty delta has nothing to say. */
  if (applied) dataListeners.forEach((cb) => cb());

  return {
    reset,
    received,
    deletions: res.deletions.length,
    orphaned,
    dirtySkipped,
    applied,
    fetchMs,
  };
}

let running: Promise<void> | null = null;
let rerun = false;
let networkFailure = false;
/** Ops the server refused during this pass; announced once, from run()'s finally. */
let rejectedThisPass = 0;
/** Ops the server accepted during this pass. */
let pushedThisPass = 0;
/** What set this pass off, for the pass event — see kick(). */
let triggerThisPass: SyncTrigger = 'unknown';

/**
 * Why a sync pass is happening.
 *
 * Worth carrying purely for the telemetry: the pass rate is dominated by the sixty-second timer,
 * so "how often does sync run" is a question with a boring and useless answer, while "how often
 * does a pass triggered by a *mutation* fail" is the one worth asking. Without this they are the
 * same event.
 */
export type SyncTrigger =
  | 'mutation'
  | 'interval'
  | 'visibility'
  | 'online'
  | 'live'
  | 'probe'
  | 'preferences'
  | 'manual'
  | 'signin'
  | 'background'
  /** Something was enqueued while a pass was already in flight, so it went again. */
  | 'rerun'
  | 'unknown';

/* The outbox is the app's health in one number: it is how many things the user believes are saved
   that the server has never seen. A backlog is normal (that is what offline-first *is*) and a
   backlog that keeps growing while passes are succeeding is not, so what gets reported is crossing
   a threshold upwards — once per crossing, not once per pass. */
const BACKLOG_THRESHOLDS = [50, 200, 1000];
let backlogReported = 0;

function reportBacklog(pending: number): void {
  const crossed = BACKLOG_THRESHOLDS.filter((t) => pending >= t).pop() ?? 0;
  if (crossed > backlogReported) trackEvent('sync_backlog', { pending, threshold: crossed });
  // Reset on the way down too, so a queue that drains and refills reports the second time.
  backlogReported = crossed;
}

/**
 * One row per sync pass — but only when the pass had something to say.
 *
 * A pass fires at least once a minute per open client whether or not the diary changed, and the
 * overwhelming majority of them push nothing, pull nothing and fail at nothing. Reporting all of
 * them would be somewhere around 1,400 rows per device per day to establish that an idle app is
 * idle, which on a fixed monthly volume is the whole budget spent on the least informative
 * possible event.
 *
 * So: everything that failed, pushed, pulled or reset is always reported, and the idle remainder
 * is sampled at 2% purely to keep a baseline — enough to tell "sync is quiet" from "sync stopped
 * running", which are indistinguishable from silence alone and mean very different things.
 */
function reportPass(
  startedAt: number,
  pendingBefore: number,
  summary: PullSummary | null,
  failure: string | null,
): void {
  const pendingAfter = getSyncStatus().pending;
  reportBacklog(pendingAfter);

  const eventful =
    failure !== null ||
    pushedThisPass > 0 ||
    rejectedThisPass > 0 ||
    (summary?.received ?? 0) > 0 ||
    (summary?.deletions ?? 0) > 0 ||
    summary?.reset === true;
  if (!eventful && !sampled(0.02)) return;

  trackEvent('sync_pass', {
    trigger: triggerThisPass,
    duration_ms: Math.round(performance.now() - startedAt),
    ok: failure === null,
    failure: failure ?? undefined,
    pushed: pushedThisPass,
    rejected: rejectedThisPass,
    pending_before: pendingBefore,
    pending_after: pendingAfter,
    // Absent rather than zero when the push never drained, so "the pull didn't run" stays
    // distinguishable from "the pull ran and found nothing".
    pulled: summary?.received,
    deletions: summary?.deletions,
    dirty_skipped: summary?.dirtySkipped,
    reset: summary?.reset,
    fetch_ms: summary?.fetchMs,
    blocker: getSyncStatus().blocker ?? undefined,
    sampled: !eventful,
  });
}

/**
 * One sync pass.
 *
 * Nothing in here clears `blocker` on the way *in*. It used to — `{ syncing: true, blocker: null }`
 * was the first thing it did — and that made the pill flicker off at the start of every attempt and
 * back on a second or two later when the request finally failed. Since a kick fires on every
 * mutation, every foreground, every minute and every probe tick, "the server is unreachable"
 * spent much of its life invisible, and the one state the user most needs to be able to trust
 * looked intermittent.
 *
 * So a blocker now survives until something *conclusive* replaces it: a completed pull, an answer
 * from the server (even an error one — it proves reachability), the health probe, or a fresh
 * failure. An attempt in flight is not evidence about its own outcome.
 */
async function run(): Promise<void> {
  await refreshPending();
  if (!navigator.onLine) {
    setStatus({ blocker: 'offline', syncing: false });
    startReconnectProbe();
    return;
  }
  networkFailure = false;
  rejectedThisPass = 0;
  pushedThisPass = 0;
  const startedAt = performance.now();
  const pendingBefore = getSyncStatus().pending;
  let summary: PullSummary | null = null;
  let failure: string | null = null;
  try {
    const drained = await pushOutbox();
    if (drained) summary = await pull();
  } catch (err) {
    failure = err instanceof ApiError ? `${err.status}:${err.code}` : 'exception';
    /* A non-ApiError escaping this far is a bug in the sync engine itself rather than a network
       condition — a Dexie transaction aborting, a malformed response — and it is the class of
       failure that leaves the outbox permanently stuck. The existing branch below logs it to a
       console nobody is reading; this is the same thing said somewhere it can be counted. */
    if (!(err instanceof ApiError)) captureError(err, { scope: 'sync.run' });
    if (err instanceof ApiError) {
      if (err.status === 0) {
        setStatus({ blocker: networkBlocker() });
        networkFailure = true;
      } else if (err.status >= 500) {
        setStatus({ blocker: 'unreachable' });
        networkFailure = true;
        console.warn('sync failed', err.code);
      } else {
        /* Any other status means the server composed a reply and sent it, so whatever went wrong
           here, it is not that we couldn't reach it — clearing is as conclusive as a success. 401
           rides this path too; needsAuth is what the UI shows for it, and it is a statement about
           the session rather than about the connection. */
        setStatus({ blocker: null, needsAuth: err.status === 401 });
        if (err.status !== 401) console.warn('sync failed', err.code);
      }
    } else {
      console.warn('sync failed', err);
    }
  } finally {
    await refreshPending();
    setStatus({ syncing: false });
    reportPass(startedAt, pendingBefore, summary, failure);
    if (networkFailure) startReconnectProbe();
    if (rejectedThisPass > 0) {
      const count = rejectedThisPass;
      rejectedThisPass = 0;
      rejectionListeners.forEach((cb) => cb(count));
      // Only when the table just grew. A kick fires every minute and on every mutation; trimming
      // on all of them would be an index scan a thousand times a day to find nothing.
      await trimDeadLetter();
    }
  }
}

/** Fire-and-forget sync request; coalesces while one is already running. */
export function kick(trigger: SyncTrigger = 'unknown'): void {
  void syncNow({ trigger });
}

/**
 * Sync this once even though "sync on Wi-Fi only" says not to.
 *
 * Only ever called from a button the user pressed, which is what makes it a different thing from
 * quietly ignoring the setting: the preference still holds for every automatic trigger, and this
 * costs exactly one sync's worth of cellular data, chosen deliberately. If the server turns out to
 * be unreachable, the ordinary failure path takes over and the pill says so instead.
 */
export function forceSyncNow(): Promise<void> {
  return syncNow({ ignoreWifiOnly: true, trigger: 'manual' });
}

export function syncNow(
  options: { ignoreWifiOnly?: boolean; trigger?: SyncTrigger } = {},
): Promise<void> {
  // Never linked to an account (or explicitly local-only) — nothing to push or pull yet.
  // Mutations still queue in db.outbox unconditionally; the moment an account is linked,
  // getCachedUser() becomes non-null and the very next kick() drains the whole queue in order.
  if (!getCachedUser()) return Promise.resolve();
  /* Wi-fi-only is enforced here rather than in the BackgroundFetch config, so one guard covers the
     foreground timer, the resume kick and the background wake alike, and so toggling it takes
     effect immediately instead of at the next launch. Nothing is lost by waiting: writes keep
     queueing in db.outbox exactly as they do offline, and the next kick on wi-fi drains them.

     Saying so is the whole point of the two lines inside. This used to return here in silence,
     leaving `blocker` null and the pending count frozen at whatever it was — so the app was
     visually indistinguishable from fully synced while the outbox grew behind it, on a setting the
     user may have turned on months ago. `navigator.onLine` is checked first so a device with no
     network at all reports being offline rather than waiting for a Wi-Fi it couldn't use either. */
  if (
    !options.ignoreWifiOnly &&
    navigator.onLine &&
    getPreferences().syncOnWifiOnly &&
    isMeteredConnection()
  ) {
    setStatus({ blocker: 'paused' });
    void refreshPending();
    return Promise.resolve();
  }
  ensureLiveChannel();
  if (running) {
    rerun = true; // something changed mid-sync: go again right after
    return running;
  }
  // Set here rather than at the top: a coalesced call returns above without starting a pass, and
  // overwriting the trigger there would attribute the running pass to whatever arrived during it.
  triggerThisPass = options.trigger ?? 'unknown';
  /* Before run() rather than inside it, so `syncing` is true from the very moment a pass exists —
     run() awaits a count before it gets going, and waitForOutboxDrain reads a blocker seen while
     `syncing` is false as the pass's verdict. In that gap it is only the last pass's. */
  setStatus({ syncing: true });
  running = run().finally(() => {
    running = null;
    if (rerun) {
      rerun = false;
      kick('rerun');
    }
  });
  return running;
}

let initialized = false;

/** Wire up the background triggers once (call from app bootstrap). */
export function initSync(): void {
  if (initialized) return;
  initialized = true;
  /* Only `offline` is conclusive. The browser saying the network is back says nothing about the
     server being back — a captive portal is "online" — so this no longer clears the pill and
     leaves it to the sync it triggers. What it *can* do is stop claiming the device has no
     network, which is now demonstrably false: 'offline' becomes 'unreachable', the weaker and
     still-true statement, and the kick settles it either way within a request. */
  window.addEventListener('online', () => {
    if (getSyncStatus().blocker === 'offline') setStatus({ blocker: 'unreachable' });
    kick('online');
  });
  window.addEventListener('offline', () => setStatus({ blocker: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kick('visibility');
  });
  /* Turning "sync on Wi-Fi only" off, on a phone that has been holding writes back for hours,
     should drain them now rather than at the next minute tick — and turning it on should show
     the paused pill immediately rather than leaving the app looking synced until then. */
  // Wrapped rather than passed by reference: kick() now takes an argument, and a subscriber called
  // with whatever the store hands its listeners would report that as the trigger.
  subscribePreferences(() => kick('preferences'));
  setInterval(() => kick('interval'), 60_000);
  void refreshPending();
  /* The age cap needs a trigger that doesn't depend on new rejections, or a table that stopped
     growing would keep its oldest rows for good. Once per launch is plenty for a 90-day bound. */
  void trimDeadLetter();
}
