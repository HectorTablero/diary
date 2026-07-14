import { refreshNotifications } from '@/lib/notifications';
import { db, type OutboxOp } from './db';
import { kick } from './sync';

/* Queues a mutation for replay against the REST API (see sync.ts's pushOutbox). Split out of
   mutations.ts so db/repo.ts's lazy orderKey healer can enqueue sync ops too, without repo.ts
   importing mutations.ts (which already imports repo.ts — that would be a cycle). */

export async function enqueue(method: OutboxOp['method'], path: string, body?: unknown): Promise<void> {
  await db.outbox.add({ method, path, body });
  kick();
  refreshNotifications();
}

/** Queue many ops at once, kicking sync and rescheduling notifications a single time.
    Importing 200 contacts through `enqueue` would otherwise run 200 full notification
    reconciles, each of which re-reads every person. */
export async function enqueueBatch(ops: OutboxOp[]): Promise<void> {
  if (!ops.length) return;
  await db.outbox.bulkAdd(ops);
  kick();
  refreshNotifications();
}
