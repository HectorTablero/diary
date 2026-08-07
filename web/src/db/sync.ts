import type { SyncCollection, SyncResponse } from '@diary/shared';
import { API_BASE, CLIENT_ID, api, ApiError, apiGet } from '@/lib/apiClient';
import { isMeteredConnection } from '@/lib/network';
import { getPreferences, subscribePreferences } from '@/lib/preferences';
import { getCachedUser } from '@/lib/sessionCache';
import { db, entryFromDto, getMeta, personFromDto, setMeta, type OutboxOp } from './db';

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

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((cb) => cb());
}

export const getSyncStatus = (): SyncStatus => status;

export function subscribeSyncStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
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
 * Replay queued ops in order. Returns true when the queue fully drained.
 * Tolerance rules keep replays idempotent: a 404 on DELETE/PATCH/PUT means the
 * doc is already gone; a 409 on POST means the create already applied (or lost
 * a name race) — drop the op and let the pull reconcile.
 */
async function pushOutbox(): Promise<boolean> {
  for (;;) {
    const op = await db.outbox.orderBy('seq').first();
    if (!op) return true;
    try {
      await api(op.path, {
        method: op.method,
        body: op.body === undefined ? undefined : JSON.stringify(op.body),
      });
      await db.outbox.delete(op.seq!);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
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
      if (err.status === 409 && op.method === 'POST') {
        await removeLocalDoc(op);
        await db.outbox.delete(op.seq!);
        continue;
      }
      if (err.status === 404 && op.method !== 'POST') {
        await db.outbox.delete(op.seq!);
        continue;
      }
      /* Any other 4xx would jam the queue forever, so it has to leave the queue — but it must not
         leave without a trace. The local copy of this change still says "saved", and only the
         dead-letter row and the toast that follows it stop the user finding out on another device
         months later, or not at all. */
      console.warn('sync: rejected op moved to dead letter', op, err.code);
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
    }
  }
}

/** A conflicted local create is a phantom (never made it to the server): remove it. */
async function removeLocalDoc(op: OutboxOp) {
  const id = (op.body as { id?: string } | undefined)?.id;
  if (!id) return;
  if (op.path.startsWith('/entries')) await db.entries.delete(id);
  else if (op.path.startsWith('/people')) await db.people.delete(id);
  else if (op.path.startsWith('/tags')) await db.tags.delete(id);
  else if (op.path.startsWith('/threads')) await db.threads.delete(id);
}

/* Live channel: a WebSocket per open client. The server nudges the user's
   other devices after every mutation, so edits appear everywhere within
   moments while the diary is open on several devices. */

let liveSocket: WebSocket | null = null;
let liveConnecting = false;

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
      socket.onmessage = (event) => {
        if (event.data === 'changed') kick();
      };
      socket.onclose = () => {
        if (liveSocket === socket) liveSocket = null;
        // Gentle retry; kick()/interval also re-open it on their own triggers.
        setTimeout(ensureLiveChannel, 10_000);
      };
      socket.onerror = () => socket.close();
      liveSocket = socket;
    } catch {
      liveSocket = null; // not signed in yet or offline; later triggers retry
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
    kick();
  }, PROBE_INTERVAL_MS);
}

async function pull(): Promise<void> {
  const since = await getMeta<string>('syncCursor');
  const res = await apiGet<SyncResponse>(
    `/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`,
  );
  const dirty = await dirtyIds();
  const clean = <T extends { id: string }>(docs: T[]) => docs.filter((d) => !dirty.has(d.id));

  const threads = res.threads ?? []; // tolerates a server that predates threads (stale deploy)

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
  };

  await db.transaction('rw', [db.entries, db.people, db.tags, db.threads, db.meta], async () => {
    await db.entries.bulkPut(clean(res.entries).map(entryFromDto));
    await db.people.bulkPut(clean(res.people).map(personFromDto));
    await db.tags.bulkPut(clean(res.tags));
    await db.threads.bulkPut(clean(threads));
    const tables: Record<SyncCollection, { delete: (key: string) => Promise<void> }> = {
      entry: db.entries,
      person: db.people,
      tag: db.tags,
      thread: db.threads,
    };
    for (const del of res.deletions) {
      if (dirty.has(del.docId)) continue; // an unpushed local edit outranks the server
      if (alive[del.coll]?.has(del.docId)) continue; // re-created since: stale tombstone
      await tables[del.coll]?.delete(del.docId);
    }
    await setMeta('settings', res.settings);
    // 10s overlap absorbs clock skew between capture and the queries; upserts are idempotent.
    await setMeta('syncCursor', new Date(Date.parse(res.serverTime) - 10_000).toISOString());
  });
  setStatus({ needsAuth: false, lastSyncAt: new Date().toISOString() });
  stopReconnectProbe(); // reached the server through some other trigger
  dataListeners.forEach((cb) => cb());
}

let running: Promise<void> | null = null;
let rerun = false;
let networkFailure = false;
/** Ops the server refused during this pass; announced once, from run()'s finally. */
let rejectedThisPass = 0;

async function run(): Promise<void> {
  await refreshPending();
  if (!navigator.onLine) {
    setStatus({ blocker: 'offline' });
    startReconnectProbe();
    return;
  }
  setStatus({ syncing: true, blocker: null });
  networkFailure = false;
  rejectedThisPass = 0;
  try {
    const drained = await pushOutbox();
    if (drained) await pull();
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) {
        setStatus({ blocker: networkBlocker() });
        networkFailure = true;
      } else if (err.status === 401) {
        setStatus({ needsAuth: true });
      } else {
        if (err.status >= 500) {
          setStatus({ blocker: 'unreachable' });
          networkFailure = true;
        }
        console.warn('sync failed', err.code);
      }
    } else {
      console.warn('sync failed', err);
    }
  } finally {
    await refreshPending();
    setStatus({ syncing: false });
    if (networkFailure) startReconnectProbe();
    if (rejectedThisPass > 0) {
      const count = rejectedThisPass;
      rejectedThisPass = 0;
      rejectionListeners.forEach((cb) => cb(count));
    }
  }
}

/** Fire-and-forget sync request; coalesces while one is already running. */
export function kick(): void {
  void syncNow();
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
  return syncNow({ ignoreWifiOnly: true });
}

export function syncNow(options: { ignoreWifiOnly?: boolean } = {}): Promise<void> {
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
  running = run().finally(() => {
    running = null;
    if (rerun) {
      rerun = false;
      kick();
    }
  });
  return running;
}

let initialized = false;

/** Wire up the background triggers once (call from app bootstrap). */
export function initSync(): void {
  if (initialized) return;
  initialized = true;
  window.addEventListener('online', () => {
    setStatus({ blocker: null });
    kick();
  });
  window.addEventListener('offline', () => setStatus({ blocker: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kick();
  });
  /* Turning "sync on Wi-Fi only" off, on a phone that has been holding writes back for hours,
     should drain them now rather than at the next minute tick — and turning it on should show
     the paused pill immediately rather than leaving the app looking synced until then. */
  subscribePreferences(kick);
  setInterval(kick, 60_000);
  void refreshPending();
}
