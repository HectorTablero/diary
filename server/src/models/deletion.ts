import type { SyncCollection } from '@diary/shared';
import { model, Schema, type Types } from 'mongoose';

/** Tombstones so offline clients learn about deletes on their next sync pull. */
const deletionSchema = new Schema({
  userId: { type: String, required: true },
  coll: { type: String, required: true, enum: ['entry', 'person', 'tag'] },
  docId: { type: Schema.Types.ObjectId, required: true },
  deletedAt: { type: Date, required: true, default: Date.now },
});

deletionSchema.index({ userId: 1, deletedAt: -1 });

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
