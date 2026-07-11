import type { SearchResponse } from '@diary/shared';
import { OBJECT_ID_REGEX, searchQuerySchema } from '@diary/shared';
import { Hono } from 'hono';
import { Types } from 'mongoose';
import type { FilterQuery } from 'mongoose';
import type { AppEnv } from '../middleware/session';
import { queryValidator } from '../middleware/validate';
import { Entry } from '../models/entry';
import { ENTRY_POPULATE, entryToDto, type LeanEntry } from '../dto';

const parseIdList = (value?: string) =>
  (value ?? '')
    .split(',')
    .filter((id) => OBJECT_ID_REGEX.test(id))
    .map((id) => new Types.ObjectId(id));

const parseImportanceList = (value?: string) =>
  (value ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);

export const searchRouter = new Hono<AppEnv>().get(
  '/',
  queryValidator(searchQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const { q, tags, people, importance, from, to, page, limit } = c.req.valid('query');

    const query: FilterQuery<typeof Entry> = { userId };
    if (q) query.$text = { $search: q };
    const tagIds = parseIdList(tags);
    if (tagIds.length) query.tags = { $in: tagIds };
    const personIds = parseIdList(people);
    if (personIds.length) query.people = { $in: personIds };
    const importances = parseImportanceList(importance);
    if (importances.length) query.importance = { $in: importances };
    if (from || to) {
      query.dateKey = {};
      if (from) query.dateKey.$gte = from;
      if (to) query.dateKey.$lte = to;
    }

    const projection = q ? { score: { $meta: 'textScore' } } : {};
    const sort: Record<string, unknown> = q
      ? { score: { $meta: 'textScore' }, dateKey: -1 }
      : { dateKey: -1, createdAt: -1 };

    const [total, entries] = await Promise.all([
      Entry.countDocuments(query),
      Entry.find(query, projection)
        .sort(sort as never)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(ENTRY_POPULATE)
        .lean(),
    ]);

    const response: SearchResponse = {
      results: (entries as unknown as LeanEntry[]).map(entryToDto),
      total,
      page,
      limit,
    };
    return c.json(response);
  },
);
