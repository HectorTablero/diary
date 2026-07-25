import { OBJECT_ID_REGEX, threadCreateSchema, threadUpdateSchema } from '@diary/shared';
import { Hono } from 'hono';
import { Types } from 'mongoose';
import { conflict, notFound } from '../errors';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { recordDeletions } from '../models/deletion';
import { Entry } from '../models/entry';
import { Thread } from '../models/thread';
import { threadToDto, type LeanThread } from '../dto';

const oid = (value: string) => {
  if (!OBJECT_ID_REGEX.test(value)) throw notFound('thread.not_found');
  return value;
};

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

/* Writes only — the thread list and its entry counts are derived on the client (repo.getThreads). */
export const threadsRouter = new Hono<AppEnv>()
  .post('/', jsonValidator(threadCreateSchema), async (c) => {
    const userId = c.get('userId');
    const input = c.req.valid('json');
    try {
      // timestamps off: keep updatedAt at server time (not createdAt) so replayed offline
      // creates still hit other clients' sync cursors.
      const [thread] = await Thread.create(
        [
          {
            _id: input.id ? new Types.ObjectId(input.id) : new Types.ObjectId(),
            createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
            updatedAt: new Date(),
            userId,
            name: input.name,
          },
        ],
        { timestamps: false },
      );
      return c.json(threadToDto(thread.toObject() as unknown as LeanThread), 201);
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('thread.duplicate_name');
      throw err;
    }
  })
  .patch('/:id', jsonValidator(threadUpdateSchema), async (c) => {
    const userId = c.get('userId');
    const input = c.req.valid('json');
    try {
      const thread = await Thread.findOneAndUpdate(
        { _id: oid(c.req.param('id')), userId },
        { $set: input },
        { new: true, runValidators: true },
      ).lean();
      if (!thread) throw notFound('thread.not_found');
      return c.json(threadToDto(thread as unknown as LeanThread));
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('thread.duplicate_name');
      throw err;
    }
  })
  .delete('/:id', async (c) => {
    const userId = c.get('userId');
    const id = oid(c.req.param('id'));
    const thread = await Thread.findOneAndDelete({ _id: id, userId }).lean();
    if (!thread) throw notFound('thread.not_found');
    const threadId = new Types.ObjectId(id);
    // Deleting a thread only ungroups its entries; the entries themselves, and every saidTo mark
    // a "mark all" ever wrote, are untouched — those live on the entries and are the real record.
    await Promise.all([
      Entry.updateMany({ userId, threads: threadId }, { $pull: { threads: threadId } }),
      recordDeletions(userId, 'thread', [threadId]),
    ]);
    return c.json({ ok: true });
  });
