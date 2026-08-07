import type { SyncCollection } from '@diary/shared';
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
