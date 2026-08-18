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
  .patch('/:id', jsonValidator(pluginDocumentUpdateSchema), async (c) => {
    const userId = c.get('userId');
    const input = c.req.valid('json');
    const doc = await PluginDocument.findOneAndUpdate(
      { _id: oid(c.req.param('id')), userId },
      { $set: input },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!doc) throw notFound('pluginDocument.not_found');
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
