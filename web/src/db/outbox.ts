import { refreshNotifications } from '@/lib/notifications';
import { captureError } from '@/lib/telemetry';
import { bumpLookupVersion, db, type OutboxOp } from './db';
import { isQuotaError } from './storage';
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

/**
 * Report a local write that failed, then re-throw.
 *
 * This is the only place in the write path that can. `mutations.ts` contains no `try/catch` at all
 * — eleven writers, none of them handling a rejection — and none of the `useMutation` hooks in
 * `api/hooks.ts` declare an `onError`, so a Dexie failure on a user write currently reaches nothing
 * but React Query's internal error state. Enqueuing is the one step a local write cannot skip (see
 * the note above `invalidateCachesFor`), which makes this the single point that covers all of them
 * without touching any.
 *
 * Quota is called out separately because it is the only one of these the user can act on, and the
 * only one that is not a bug. An offline-first app is a database that grows until someone deletes
 * something; on a device that is genuinely full, every write from here on fails and the app has no
 * way to say why unless this row exists.
 *
 * Re-thrown rather than swallowed: the caller believing a write succeeded when it did not is the
 * exact divergence the dead-letter table exists to prevent on the server side, and it would be
 * worse here — there would be no local copy either.
 */
async function reportWriteFailure<T>(scope: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    captureError(err, { scope, quota: isQuotaError(err) });
    throw err;
  }
}

export async function enqueue(
  method: OutboxOp['method'],
  path: string,
  body?: unknown,
): Promise<void> {
  await reportWriteFailure('outbox.enqueue', () => db.outbox.add({ method, path, body }));
  invalidateCachesFor([path]);
  kick('mutation');
  refreshNotifications();
}

/** Queue many ops at once, kicking sync and rescheduling notifications a single time.
    Importing 200 contacts through `enqueue` would otherwise run 200 full notification
    reconciles, each of which re-reads every person. */
export async function enqueueBatch(ops: OutboxOp[]): Promise<void> {
  if (!ops.length) return;
  // The likeliest quota failure in the app: importing 200 contacts, or a backup restore.
  await reportWriteFailure('outbox.enqueueBatch', () => db.outbox.bulkAdd(ops));
  invalidateCachesFor(ops.map((op) => op.path));
  kick('mutation');
  refreshNotifications();
}
