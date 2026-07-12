import type { SyncResponse } from '@diary/shared';
import { api, ApiError, apiGet } from '@/lib/apiClient';
import { db, entryFromDto, getMeta, personFromDto, setMeta, type OutboxOp } from './db';

/* Sync engine: replays the outbox against the REST API in order (push), then
   pulls everything changed since the last cursor. Pull only runs after a fully
   drained outbox, so server state can never clobber unpushed local edits. */

export interface SyncStatus {
  pending: number;
  syncing: boolean;
  offline: boolean;
  /** The server rejected our session — data stays local until the user signs in again. */
  needsAuth: boolean;
  lastSyncAt: string | null;
}

let status: SyncStatus = {
  pending: 0,
  syncing: false,
  offline: !navigator.onLine,
  needsAuth: false,
  lastSyncAt: null,
};

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
        setStatus({ offline: true });
        return false;
      }
      if (err.status === 401) {
        setStatus({ needsAuth: true });
        return false;
      }
      if (err.status >= 500) return false; // server hiccup: retry next sync
      if (err.status === 409 && op.method === 'POST') {
        await removeLocalDoc(op);
        await db.outbox.delete(op.seq!);
        continue;
      }
      if (err.status === 404 && op.method !== 'POST') {
        await db.outbox.delete(op.seq!);
        continue;
      }
      // Any other 4xx would jam the queue forever — drop it and move on.
      console.warn('sync: dropping rejected op', op, err.code);
      await db.outbox.delete(op.seq!);
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
}

async function pull(): Promise<void> {
  const since = await getMeta<string>('syncCursor');
  const res = await apiGet<SyncResponse>(
    `/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`,
  );
  const dirty = await dirtyIds();
  const clean = <T extends { id: string }>(docs: T[]) => docs.filter((d) => !dirty.has(d.id));

  await db.transaction('rw', [db.entries, db.people, db.tags, db.meta], async () => {
    await db.entries.bulkPut(clean(res.entries).map(entryFromDto));
    await db.people.bulkPut(clean(res.people).map(personFromDto));
    await db.tags.bulkPut(clean(res.tags));
    for (const del of res.deletions) {
      if (dirty.has(del.docId)) continue;
      if (del.coll === 'entry') await db.entries.delete(del.docId);
      else if (del.coll === 'person') await db.people.delete(del.docId);
      else await db.tags.delete(del.docId);
    }
    await setMeta('settings', res.settings);
    // 10s overlap absorbs clock skew between capture and the queries; upserts are idempotent.
    await setMeta('syncCursor', new Date(Date.parse(res.serverTime) - 10_000).toISOString());
  });
  setStatus({ needsAuth: false, lastSyncAt: new Date().toISOString() });
  dataListeners.forEach((cb) => cb());
}

let running: Promise<void> | null = null;
let rerun = false;

async function run(): Promise<void> {
  await refreshPending();
  if (!navigator.onLine) {
    setStatus({ offline: true });
    return;
  }
  setStatus({ syncing: true, offline: false });
  try {
    const drained = await pushOutbox();
    if (drained) await pull();
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) setStatus({ offline: true });
      else if (err.status === 401) setStatus({ needsAuth: true });
      else console.warn('sync failed', err.code);
    } else {
      console.warn('sync failed', err);
    }
  } finally {
    await refreshPending();
    setStatus({ syncing: false });
  }
}

/** Fire-and-forget sync request; coalesces while one is already running. */
export function kick(): void {
  void syncNow();
}

export function syncNow(): Promise<void> {
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
    setStatus({ offline: false });
    kick();
  });
  window.addEventListener('offline', () => setStatus({ offline: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kick();
  });
  setInterval(kick, 60_000);
  void refreshPending();
}
