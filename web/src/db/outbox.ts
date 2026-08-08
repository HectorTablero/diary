import { refreshNotifications } from '@/lib/notifications';
import { bumpLookupVersion, db, type OutboxOp } from './db';
import { kick } from './sync';

/* Queues a mutation for replay against the REST API (see sync.ts's pushOutbox). Split out of
   mutations.ts so db/repo.ts's lazy orderKey healer can enqueue sync ops too, without repo.ts
   importing mutations.ts (which already imports repo.ts — that would be a cycle). */

/**
 * Drop repo.ts's cached lookup maps when an op touches one of the tables they're built from.
 *
 * Here rather than at the eleven places in mutations.ts that write those tables, because this is
 * the one step a local write cannot skip: a mutation that doesn't enqueue never reaches the server,
 * which is a loud and immediately visible bug. A mutation that forgot to invalidate a cache would
 * instead show a stale name on some other screen, for the rest of the session, and only sometimes.
 * Tie the fragile invariant to the unmissable one.
 */
function invalidateCachesFor(paths: string[]): void {
  if (paths.some((path) => /^\/(people|tags|threads)\b/.test(path))) bumpLookupVersion();
}

export async function enqueue(
  method: OutboxOp['method'],
  path: string,
  body?: unknown,
): Promise<void> {
  await db.outbox.add({ method, path, body });
  invalidateCachesFor([path]);
  kick();
  refreshNotifications();
}

/** Queue many ops at once, kicking sync and rescheduling notifications a single time.
    Importing 200 contacts through `enqueue` would otherwise run 200 full notification
    reconciles, each of which re-reads every person. */
export async function enqueueBatch(ops: OutboxOp[]): Promise<void> {
  if (!ops.length) return;
  await db.outbox.bulkAdd(ops);
  invalidateCachesFor(ops.map((op) => op.path));
  kick();
  refreshNotifications();
}
