import { MAX_PLUGIN_DOCUMENT_ROWS_PER_PLUGIN } from '@diary/shared';
import { model, Schema } from 'mongoose';

/**
 * Plugin-owned documents and their per-day revisions, in one collection.
 *
 * The sibling of `pluginRecord`, and the deliberate exception to its rule. That collection buys
 * "adding a plugin is a client-only change" by keeping `data` opaque and small; this one gives that
 * up on purpose for two things a document needs and an opaque blob cannot provide — see the block
 * comment above MAX_PLUGIN_DOCUMENT_BYTES in @diary/shared.
 *
 * Two row shapes live here, told apart by `dateKey` (`''` = document, a date = a revision of one).
 * Nothing in this file branches on that: to the server both are a row with a text `body`, and only
 * the unique index below cares which is which.
 */
const pluginDocumentSchema = new Schema(
  {
    userId: { type: String, required: true },
    pluginId: { type: String, required: true },
    /* Not `required`, and it must stay that way — Mongoose reads `required` on a String as
       "present and non-empty" and would reject every document row, whose dateKey *is* the empty
       sentinel. The same trap `pluginRecord.dateKey` documents at length; the shape is guaranteed
       by pluginDocumentCreateSchema at the edge instead. */
    dateKey: { type: String, default: '' },
    /** Revisions only: the document this revises. `''` on a document row, for the same reason. */
    documentId: { type: String, default: '' },
    /** Documents only: the parent in the client's tree. Never walked here. */
    parentId: { type: String, default: '' },
    title: { type: String, default: '' },
    /**
     * A document's current text, or a revision's encoded patch.
     *
     * A real `String` rather than `Mixed`, unlike `pluginRecord.data`, and that is the point of the
     * collection: a typed text field is one the *client app* can rewrite @mentions inside when a
     * person is renamed, without loading the plugin that owns it. See renamePerson in
     * web/src/db/mutations.ts — a rename has to reach the prose of a plugin that is switched off.
     */
    body: { type: String, default: '' },
    sortKey: { type: String, default: '' },
    /** Revisions only: characters written that day, and characters taken out. The calendar
        shades by `added`; the day card reports both. */
    added: { type: Number, default: 0 },
    removed: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/* Serves the sync delta directly, and the per-plugin row count that enforces the cap below —
   the same index, for the same two reasons, as the one on pluginRecord. Revisions accrue at up to
   one per document per day forever, so this collection has the same "more rows than the whole
   diary" property that made an updatedAt index worth its write cost there. */
pluginDocumentSchema.index({ userId: 1, pluginId: 1, updatedAt: 1 });

/* At most one revision per document per day.
 *
 * This is what makes a day of *history* converge instead of forking. Two devices editing the same
 * document on the same day both create a revision for it; the second create collides here and comes
 * back 409, which the client already knows how to resolve — pushOutbox drops the phantom local row
 * and the next pull brings the server's (removeLocalDoc in web/src/db/sync.ts). Without it the two
 * rows would both survive and the document's history would have two versions of one day in it.
 *
 * Note what is *not* at risk when that happens, and why it took a second mechanism to say so: the
 * day's writing itself lives in the document's own `body`, which is merged rather than overwritten
 * (see `baseVersion` on the PATCH route). Losing the collided revision costs a day's entry in the
 * timeline until the next save rewrites it; it never cost the prose.
 *
 * Partial on `documentId` being non-empty, so it constrains revisions only: document rows all carry
 * `''` for both keys and would otherwise be unique-per-plugin, which is to say limited to one. */
pluginDocumentSchema.index(
  { userId: 1, pluginId: 1, documentId: 1, dateKey: 1 },
  { unique: true, partialFilterExpression: { documentId: { $gt: '' } } },
);

/* The tree read: a plugin's documents, without dragging every revision along. Revisions outnumber
   documents by however many days the diary is old, so filtering them out in memory would make
   opening the notebook proportional to its history rather than to its size. */
pluginDocumentSchema.index({ userId: 1, pluginId: 1, dateKey: 1 });

export const PluginDocument = model('PluginDocument', pluginDocumentSchema);

/** Built at startup rather than by `autoIndex`, for the reasons on ensurePluginRecordIndexes. */
export async function ensurePluginDocumentIndexes(): Promise<void> {
  await PluginDocument.syncIndexes();
}

/**
 * Whether this write would push the account past the row cap.
 *
 * One cap rather than pluginRecord's two: the distinct-plugin bound is already enforced against
 * that collection, and a plugin has to have a config row there to be enabled at all.
 *
 * Only checked on create, and racy under concurrent ones — both true of the caps next door, and
 * accepted for the same reason: this exists to stop unbounded growth, not to be exact.
 */
export async function pluginDocumentCapExceeded(
  userId: string,
  pluginId: string,
): Promise<'rows' | null> {
  const rows = await PluginDocument.countDocuments({ userId, pluginId });
  return rows >= MAX_PLUGIN_DOCUMENT_ROWS_PER_PLUGIN ? 'rows' : null;
}

/**
 * Gauges proving this collection stays bounded, in the same spirit as pluginRecordGauges.
 *
 * `plugin_document_bytes` is the one with no counterpart there. Rows are capped by count, but a row
 * here can be a quarter of a megabyte, so the count alone stops describing the cost — an account can
 * sit at a fraction of the row cap and still be the largest thing in the database.
 */
export async function pluginDocumentGauges(): Promise<Record<string, number>> {
  const [count, stats] = await Promise.all([
    PluginDocument.estimatedDocumentCount(),
    PluginDocument.aggregate<{ rows: number; bytes: number }>([
      {
        $group: {
          _id: { userId: '$userId', pluginId: '$pluginId' },
          rows: { $sum: 1 },
          bytes: { $sum: { $strLenBytes: { $ifNull: ['$body', ''] } } },
        },
      },
      { $sort: { rows: -1 } },
      { $limit: 1 },
    ]),
  ]);
  return {
    plugin_documents: count,
    ...(stats[0]
      ? {
          plugin_documents_busiest: stats[0].rows,
          plugin_document_bytes_busiest: stats[0].bytes,
        }
      : {}),
  };
}
