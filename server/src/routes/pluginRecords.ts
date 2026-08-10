import { OBJECT_ID_REGEX, pluginRecordCreateSchema, pluginRecordUpdateSchema } from '@diary/shared';
import { Hono } from 'hono';
import { Types } from 'mongoose';
import { badRequest, conflict, isDuplicateKey, notFound } from '../errors';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { clearDeletions, recordDeletions } from '../models/deletion';
import { pluginCapExceeded, PluginRecord } from '../models/pluginRecord';
import { pluginRecordToDto, type LeanPluginRecord } from '../dto';

/* Mounted flat, at /plugin-records rather than /plugins/:pluginId/records.
 *
 * Not a style choice. The client's dirtyIds() reads `path.split('/')[1]` as the document id, which
 * is how a pull knows not to overwrite a row with an unpushed local edit. Under a nested path that
 * segment is the plugin id, and a queued offline DELETE — which carries no body to fall back on —
 * would never reach the dirty set, so the next pull would resurrect the deleted row. The pluginId
 * belongs in the body, where it is data, not in the path, where it is structure. */

const oid = (value: string) => {
  if (!OBJECT_ID_REGEX.test(value)) throw notFound('pluginRecord.not_found');
  return value;
};

export const pluginRecordsRouter = new Hono<AppEnv>()
  .post('/', jsonValidator(pluginRecordCreateSchema), async (c) => {
    const userId = c.get('userId');
    const input = c.req.valid('json');

    const exceeded = await pluginCapExceeded(userId, input.pluginId);
    if (exceeded) throw badRequest(`pluginRecord.too_many_${exceeded}`);

    try {
      // timestamps off: keep updatedAt at server time (not createdAt) so replayed offline
      // creates still hit other clients' sync cursors. Same reasoning as threads.
      const [record] = await PluginRecord.create(
        [
          {
            _id: input.id ? new Types.ObjectId(input.id) : new Types.ObjectId(),
            createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
            updatedAt: new Date(),
            userId,
            pluginId: input.pluginId,
            scope: input.scope,
            dateKey: input.dateKey,
            data: input.data,
          },
        ],
        { timestamps: false },
      );
      // Re-creating a deleted id (undo) retracts its tombstone; a fresh id never had one.
      if (input.id) await clearDeletions(userId, 'pluginRecord', [record._id]);
      return c.json(pluginRecordToDto(record.toObject() as unknown as LeanPluginRecord), 201);
    } catch (err) {
      // A collision on _id means this exact row is already there — a replayed create, which is a
      // success rather than a conflict.
      if (input.id && isDuplicateKey(err, '_id')) {
        const existing = await PluginRecord.findOne({ _id: input.id, userId }).lean();
        if (existing) return c.json(pluginRecordToDto(existing as unknown as LeanPluginRecord));
      }
      /* The other unique index is the partial one on config rows. Hitting it means this plugin
         already has a config row under a *different* id — two devices enabled the plugin while
         both were offline. A conflict rather than a silent merge: the client drops its phantom
         local row (removeLocalDoc) and takes the server's, which is the same convergence rule
         every other 409-on-create follows. */
      if (isDuplicateKey(err)) throw conflict('pluginRecord.duplicate_config');
      throw err;
    }
  })
  .patch('/:id', jsonValidator(pluginRecordUpdateSchema), async (c) => {
    const userId = c.get('userId');
    const input = c.req.valid('json');
    /* $set with a whole replacement `data`, never a mutation of a hydrated document: Mongoose's
       Mixed type has no change tracking, so an in-place edit needs markModified('data') and would
       otherwise save nothing at all — silently, with a 200. */
    const record = await PluginRecord.findOneAndUpdate(
      { _id: oid(c.req.param('id')), userId },
      { $set: input },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!record) throw notFound('pluginRecord.not_found');
    return c.json(pluginRecordToDto(record as unknown as LeanPluginRecord));
  })
  .delete('/:id', async (c) => {
    const userId = c.get('userId');
    const id = oid(c.req.param('id'));
    const record = await PluginRecord.findOneAndDelete({ _id: id, userId }).lean();
    if (!record) throw notFound('pluginRecord.not_found');
    await recordDeletions(userId, 'pluginRecord', [new Types.ObjectId(id)]);
    return c.json({ ok: true });
  });
