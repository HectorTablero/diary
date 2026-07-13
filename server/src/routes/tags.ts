import { DEFAULT_TAG_COLORS, OBJECT_ID_REGEX, tagCreateSchema, tagUpdateSchema } from '@diary/shared';
import { Hono } from 'hono';
import { Types } from 'mongoose';
import { conflict, notFound } from '../errors';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { recordDeletions } from '../models/deletion';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { Tag } from '../models/tag';
import { tagToDto, type LeanTag } from '../dto';

const oid = (value: string) => {
  if (!OBJECT_ID_REGEX.test(value)) throw notFound('tag.not_found');
  return value;
};

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

/** First palette color not yet used by this user's tags (cycles when all are taken). */
async function nextColor(userId: string): Promise<string> {
  const used = new Set((await Tag.find({ userId }, 'color').lean()).map((t) => t.color));
  return DEFAULT_TAG_COLORS.find((c) => !used.has(c)) ?? DEFAULT_TAG_COLORS[used.size % DEFAULT_TAG_COLORS.length];
}

/* Writes only — the tag list and its usage counts are derived on the client (repo.ts getTags). */
export const tagsRouter = new Hono<AppEnv>()
  .post('/', jsonValidator(tagCreateSchema), async (c) => {
    const userId = c.get('userId');
    const input = c.req.valid('json');
    try {
      // timestamps off: keep updatedAt at server time (not createdAt) so replayed offline
      // creates still hit other clients' sync cursors.
      const [tag] = await Tag.create(
        [
          {
            _id: input.id ? new Types.ObjectId(input.id) : new Types.ObjectId(),
            createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
            updatedAt: new Date(),
            userId,
            name: input.name,
            color: input.color ?? (await nextColor(userId)),
          },
        ],
        { timestamps: false },
      );
      return c.json(tagToDto(tag.toObject() as unknown as LeanTag), 201);
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('tag.duplicate_name');
      throw err;
    }
  })
  .patch('/:id', jsonValidator(tagUpdateSchema), async (c) => {
    const userId = c.get('userId');
    const input = c.req.valid('json');
    try {
      const tag = await Tag.findOneAndUpdate(
        { _id: oid(c.req.param('id')), userId },
        { $set: input },
        { new: true, runValidators: true },
      ).lean();
      if (!tag) throw notFound('tag.not_found');
      return c.json(tagToDto(tag as unknown as LeanTag));
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('tag.duplicate_name');
      throw err;
    }
  })
  .delete('/:id', async (c) => {
    const userId = c.get('userId');
    const id = oid(c.req.param('id'));
    const tag = await Tag.findOneAndDelete({ _id: id, userId }).lean();
    if (!tag) throw notFound('tag.not_found');
    const tagId = new Types.ObjectId(id);
    // Scoped to docs that reference the tag so only those get their updatedAt (sync cursor) bumped.
    await Promise.all([
      Entry.updateMany({ userId, tags: tagId }, { $pull: { tags: tagId } }),
      Person.updateMany({ userId, tags: tagId }, { $pull: { tags: tagId } }),
      recordDeletions(userId, 'tag', [tagId]),
    ]);
    return c.json({ ok: true });
  });
