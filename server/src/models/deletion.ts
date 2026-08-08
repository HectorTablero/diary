import type { SyncCollection } from '@diary/shared';
import { TOMBSTONE_RETENTION_MS } from '@diary/shared';
import { model, Schema, type Types } from 'mongoose';

/** Tombstones so offline clients learn about deletes on their next sync pull. */
const deletionSchema = new Schema({
  userId: { type: String, required: true },
  coll: { type: String, required: true, enum: ['entry', 'person', 'tag', 'thread'] },
  docId: { type: Schema.Types.ObjectId, required: true },
  deletedAt: { type: Date, required: true, default: Date.now },
});

deletionSchema.index({ userId: 1, deletedAt: -1 });
// Serves clearDeletions, which looks a tombstone up by exactly this triple.
deletionSchema.index({ userId: 1, coll: 1, docId: 1 });

export const Deletion = model('Deletion', deletionSchema);

/**
 * Mongo keeps tombstones a week longer than the retention window promises.
 *
 * The window is what decides whether a client's cursor still gets a delta (isCursorStale below),
 * and it must never be the thing that races the pruning. The TTL monitor sweeps on its own
 * schedule — once a minute at best, arbitrarily later on a busy or restarting server — and it
 * compares against Mongo's clock, not this process's. Both of those can only make a tombstone
 * outlive its window, never fall short of it, *provided* the sweep is aimed later than the promise.
 *
 * Get it the wrong way round and the failure is silent and permanent: a client pulls with a cursor
 * the server considers fresh, the tombstone it needed has already been swept, and the deleted doc
 * simply lives on that device forever. Keeping one for an extra week costs a redundant local
 * delete.
 */
const TTL_GRACE_MS = 7 * 86_400_000;
const TTL_INDEX_NAME = 'deletedAt_ttl';
/** Exported so a test can assert the index carries exactly this, rather than a second copy of the
    arithmetic that would agree with itself no matter what the index actually says. */
export const TOMBSTONE_TTL_SECONDS = Math.floor((TOMBSTONE_RETENTION_MS + TTL_GRACE_MS) / 1000);

/**
 * Create the TTL index, or retune an existing one.
 *
 * Deliberately not `deletionSchema.index({ deletedAt: 1 }, { expireAfterSeconds })`: a schema-level
 * declaration is only ever *created*, so on any deployment that has already run once, editing
 * TOMBSTONE_RETENTION_DAYS would leave the old duration in place and say nothing about it. Mongo
 * rejects a createIndex that redefines an existing index's options (IndexOptionsConflict, 85);
 * `collMod` is the one supported way to change a TTL's duration in place. Hence the two steps.
 */
export async function ensureTombstoneTtl(): Promise<void> {
  try {
    await Deletion.collection.createIndex(
      { deletedAt: 1 },
      { name: TTL_INDEX_NAME, expireAfterSeconds: TOMBSTONE_TTL_SECONDS },
    );
  } catch (err) {
    if ((err as { code?: number }).code !== 85) throw err;
    await Deletion.db.db!.command({
      collMod: Deletion.collection.collectionName,
      index: { name: TTL_INDEX_NAME, expireAfterSeconds: TOMBSTONE_TTL_SECONDS },
    });
  }
}

/**
 * True when a pull cursor predates the retention window, so the deletes it missed have been pruned
 * and an incremental answer would quietly omit them. Such a pull gets the full state instead.
 *
 * The server decides this rather than the client, because the client's clock is the one input to
 * this exchange that can be arbitrarily wrong — and a device whose clock is fast would conclude its
 * own cursor is fine precisely when it isn't.
 */
export const isCursorStale = (since: Date, now: Date): boolean =>
  since.getTime() < now.getTime() - TOMBSTONE_RETENTION_MS;

/**
 * Gauges proving the tombstone collection is actually bounded.
 *
 * The whole design above rests on a promise nothing has ever verified: that Mongo's TTL monitor
 * really does sweep, so the collection stays finite and a cursor inside the window really is
 * answerable with a delta. `ensureTombstoneTtl` sets the index up and reports if that fails — but a
 * TTL index that exists and is simply not being acted on (a monitor disabled on the deployment, a
 * secondary that never runs it, a `collMod` that silently didn't take) looks identical from here.
 *
 * `oldest_age_h` is the readout. It should sit just under the retention window plus the week of
 * grace and never exceed it; a value climbing past that is the sweep not happening, and the first
 * symptom otherwise would be a disk filling up months later. `count` alone would not show it —
 * a collection can grow for the entirely ordinary reason that someone deleted a lot of entries.
 *
 * Both queries are cheap enough to run once a minute: `estimatedDocumentCount` reads collection
 * metadata rather than counting, and the sort is served by the existing `{userId, deletedAt}` index.
 */
export async function tombstoneGauges(): Promise<Record<string, number>> {
  const [count, oldest] = await Promise.all([
    Deletion.estimatedDocumentCount(),
    Deletion.findOne({}, { deletedAt: 1 }).sort({ deletedAt: 1 }).lean(),
  ]);
  return {
    tombstones: count,
    // Absent rather than zero when the collection is empty — an empty collection has no oldest
    // row, and reporting 0 would read as "swept perfectly" rather than "nothing to say".
    ...(oldest
      ? { tombstone_oldest_h: Math.round((Date.now() - +oldest.deletedAt) / 3_600_000) }
      : {}),
  };
}

export async function recordDeletions(
  userId: string,
  coll: SyncCollection,
  docIds: Types.ObjectId[],
) {
  if (!docIds.length) return;
  const deletedAt = new Date();
  await Deletion.insertMany(docIds.map((docId) => ({ userId, coll, docId, deletedAt })));
}

/**
 * Drop the tombstones for ids that exist again — what undo does when it re-creates a deleted doc
 * under its original id.
 *
 * A tombstone is an assertion that a doc id no longer exists, and every client applies it on its
 * next pull. The moment the id is re-created that assertion is false, and leaving it in place
 * makes the server hold two contradictory facts about the same doc: `Entry.find` returns it (it is
 * alive, with a fresh updatedAt) while `Deletion.find` still says it was deleted. Clients pulling
 * with a cursor older than the delete get both, and the one that applies last wins — which made
 * undo look like it worked and then silently un-worked a few seconds later, differently on every
 * device depending on where each one's cursor happened to sit.
 *
 * So the recreate retracts the tombstone. That keeps the server's answer to "does this doc exist?"
 * single-valued, which is what makes undo converge to the same state on every device regardless of
 * when each one pulls.
 */
export async function clearDeletions(
  userId: string,
  coll: SyncCollection,
  docIds: Types.ObjectId[],
) {
  if (!docIds.length) return;
  await Deletion.deleteMany({ userId, coll, docId: { $in: docIds } });
}
