import type { SyncCollection, SyncResponse } from '@diary/shared';
import { syncQuerySchema } from '@diary/shared';
import { Hono } from 'hono';
import type { Types } from 'mongoose';
import type { AppEnv } from '../middleware/session';
import { queryValidator } from '../middleware/validate';
import { Deletion } from '../models/deletion';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { Tag } from '../models/tag';
import { issueWsTicket } from '../services/liveSync';
import { getSettings } from '../services/talkingPointsService';
import {
  ENTRY_POPULATE,
  entryToDto,
  personToDto,
  tagToDto,
  type LeanEntry,
  type LeanPerson,
  type LeanTag,
} from '../dto';

const PERSON_POPULATE = { path: 'tags', select: 'name color' };

interface LeanDeletion {
  coll: SyncCollection;
  docId: Types.ObjectId;
  deletedAt: Date;
}

export const syncRouter = new Hono<AppEnv>()
  // Single-use ticket for the live-sync WebSocket (see services/liveSync).
  // GET on purpose: the mutation-broadcast middleware only fires on non-GET.
  .get('/ws-ticket', (c) => c.json({ ticket: issueWsTicket(c.get('userId')) }))
  /** Pull endpoint for the local-first clients: everything changed since the cursor. */
  .get('/', queryValidator(syncQuerySchema), async (c) => {
    const userId = c.get('userId');
    const { since } = c.req.valid('query');
    // Captured before the queries run: anything written mid-request is re-sent next pull.
    const serverTime = new Date().toISOString();
    const changedSince = since ? { updatedAt: { $gt: new Date(since) } } : {};

    const [entries, people, tags, settings, deletions] = await Promise.all([
      Entry.find({ userId, ...changedSince }).populate(ENTRY_POPULATE).lean(),
      Person.find({ userId, ...changedSince }).populate(PERSON_POPULATE).lean(),
      Tag.find({ userId, ...changedSince }).lean(),
      getSettings(userId),
      since
        ? Deletion.find({ userId, deletedAt: { $gt: new Date(since) } }).lean()
        : Promise.resolve([]),
    ]);

    const response: SyncResponse = {
      serverTime,
      entries: (entries as unknown as LeanEntry[]).map(entryToDto),
      people: (people as unknown as LeanPerson[]).map(personToDto),
      tags: (tags as unknown as LeanTag[]).map(tagToDto),
      settings,
      deletions: (deletions as unknown as LeanDeletion[]).map((d) => ({
        coll: d.coll,
        docId: d.docId.toString(),
        deletedAt: d.deletedAt.toISOString(),
      })),
    };
    return c.json(response);
  });
