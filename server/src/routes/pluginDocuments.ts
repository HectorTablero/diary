import {
  OBJECT_ID_REGEX,
  pluginDocumentCreateSchema,
  pluginDocumentUpdateSchema,
} from '@diary/shared';
import { Hono } from 'hono';
import { Types } from 'mongoose';
import { badRequest, conflict, isDuplicateKey, notFound } from '../errors';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { clearDeletions, recordDeletions } from '../models/deletion';
import { pluginDocumentCapExceeded, PluginDocument } from '../models/pluginDocument';
import { pluginDocumentToDto, type LeanPluginDocument } from '../dto';

/* Mounted flat at /plugin-documents, for the same reason /plugin-records is: the client's
   dirtyIds() reads `path.split('/')[1]` as the document id, and a nested path would put the plugin
   id there — so a queued offline DELETE, which carries no body to fall back on, would never reach
   the dirty set and the next pull would resurrect the row it deleted. */

const oid = (value: string) => {
  if (!OBJECT_ID_REGEX.test(value)) throw notFound('pluginDocument.not_found');
  return value;
};

export const pluginDocumentsRouter = new Hono<AppEnv>()
  .post('/', jsonValidator(pluginDocumentCreateSchema), async (c) => {
    const userId = c.get('userId');
    const input = c.req.valid('json');

    const exceeded = await pluginDocumentCapExceeded(userId, input.pluginId);
    if (exceeded) throw badRequest(`pluginDocument.too_many_${exceeded}`);

    try {
      // timestamps off so updatedAt stays server time even for a replayed offline create, which is
      // what keeps it inside other clients' sync cursors. Same reasoning as plugin records.
      const [doc] = await PluginDocument.create(
        [
          {
            _id: input.id ? new Types.ObjectId(input.id) : new Types.ObjectId(),
            createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
            updatedAt: new Date(),
            userId,
            pluginId: input.pluginId,
            dateKey: input.dateKey,
            documentId: input.documentId,
            parentId: input.parentId,
            title: input.title,
            body: input.body,
            sortKey: input.sortKey,
            added: input.added,
            removed: input.removed,
          },
        ],
        { timestamps: false },
      );
      // Re-creating a deleted id (undo) retracts its tombstone; a fresh id never had one.
      if (input.id) await clearDeletions(userId, 'pluginDocument', [doc._id]);
      return c.json(pluginDocumentToDto(doc.toObject() as unknown as LeanPluginDocument), 201);
    } catch (err) {
      // A collision on _id is this exact row arriving twice — a replayed create, which succeeded.
      if (input.id && isDuplicateKey(err, '_id')) {
        const existing = await PluginDocument.findOne({ _id: input.id, userId }).lean();
        if (existing) return c.json(pluginDocumentToDto(existing as unknown as LeanPluginDocument));
      }
      /* The other unique index is the partial one on (documentId, dateKey): this document already
         has a revision for this day under a different id, because two devices wrote on the same day
         while at least one was offline. A conflict rather than a merge — the client drops its
         phantom local row and takes the server's, the same convergence every 409-on-create uses. */
      if (isDuplicateKey(err)) throw conflict('pluginDocument.duplicate_revision');
      throw err;
    }
  })
  /**
   * Update a row, optionally only if it hasn't moved since the client last saw it.
   *
   * `baseVersion` is the whole of the concurrency story for this collection, and the reason a
   * document survives being written on two devices at once. Without it, `body` — which carries the
   * entire text — is a last-write-wins register, and the loser's paragraph is gone with nothing
   * anywhere recording that it ever existed. With it, the second write is refused and the client
   * merges the two versions before trying again.
   *
   * `updatedAt` is the version, rather than a counter of its own: Mongoose stamps it on every
   * `findOneAndUpdate`, so it already changes on exactly the writes a precondition needs to notice,
   * and it is already on the DTO the client holds. Two writes inside the same millisecond would
   * share a stamp and the second could slip through — a race between two of the user's own devices
   * typing into one document in the same millisecond, which the client's save debounce makes
   * unreachable in practice.
   */
  .patch('/:id', jsonValidator(pluginDocumentUpdateSchema), async (c) => {
    const userId = c.get('userId');
    const { baseVersion, ...fields } = c.req.valid('json');
    const id = oid(c.req.param('id'));
    // Every field is optional, and Mongo rejects an empty `$set`. Nothing to change is not an error.
    if (Object.keys(fields).length === 0) {
      const doc = await PluginDocument.findOne({ _id: id, userId }).lean();
      if (!doc) throw notFound('pluginDocument.not_found');
      return c.json(pluginDocumentToDto(doc as unknown as LeanPluginDocument));
    }
    const doc = await PluginDocument.findOneAndUpdate(
      baseVersion ? { _id: id, userId, updatedAt: new Date(baseVersion) } : { _id: id, userId },
      { $set: fields },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!doc) {
      /* Two very different failures reach here once a precondition is in play, and the client acts
         on them differently: gone means the write is moot and is dropped, while stale means the
         write is still wanted and has to be merged and retried. Only a second lookup can tell them
         apart, and it only runs on the branch that failed. */
      if (baseVersion && (await PluginDocument.exists({ _id: id, userId }))) {
        throw conflict('pluginDocument.stale_write');
      }
      throw notFound('pluginDocument.not_found');
    }
    return c.json(pluginDocumentToDto(doc as unknown as LeanPluginDocument));
  })
  /* Deleting a document does not cascade to its revisions or its children.
     The client deletes the whole set explicitly, in one batch, because it is the only side that
     knows the tree — walking `parentId` here would mean the server holding an opinion about a shape
     it deliberately never parses. An orphaned revision is invisible (nothing reads a revision except
     through its document) and is swept by the same cap that bounds everything else. */
  .delete('/:id', async (c) => {
    const userId = c.get('userId');
    const id = oid(c.req.param('id'));
    const doc = await PluginDocument.findOneAndDelete({ _id: id, userId }).lean();
    if (!doc) throw notFound('pluginDocument.not_found');
    await recordDeletions(userId, 'pluginDocument', [new Types.ObjectId(id)]);
    return c.json({ ok: true });
  });
