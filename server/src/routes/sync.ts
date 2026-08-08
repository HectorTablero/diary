import type { SyncCollection, SyncResponse } from '@diary/shared';
import { syncQuerySchema } from '@diary/shared';
import { Hono } from 'hono';
import type { Types } from 'mongoose';
import type { AppEnv } from '../middleware/session';
import { queryValidator } from '../middleware/validate';
import { Deletion, isCursorStale } from '../models/deletion';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { Tag } from '../models/tag';
import { Thread } from '../models/thread';
import { issueWsTicket } from '../services/liveSync';
import { getSettings } from '../services/settingsService';
import {
  ENTRY_POPULATE,
  entryToDto,
  personToDto,
  tagToDto,
  threadToDto,
  type LeanEntry,
  type LeanPerson,
  type LeanTag,
  type LeanThread,
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
    const now = new Date();
    const serverTime = now.toISOString();
    const cursor = since ? new Date(since) : null;
    /* No cursor, or one so old its tombstones have been pruned — either way a delta can't describe
       what this client missed, so it gets the whole state and reconciles by absence. Answering a
       stale cursor incrementally would look perfectly healthy and leave deleted docs on the device
       forever. First sync takes this branch too: it costs nothing against an empty local store,
       and it leaves the client with one reconciliation path instead of two. */
    const reset = !cursor || isCursorStale(cursor, now);
    const changedSince = reset ? {} : { updatedAt: { $gt: cursor } };

    const [entries, people, tags, threads, settings, deletions] = await Promise.all([
      Entry.find({ userId, ...changedSince })
        .populate(ENTRY_POPULATE)
        .lean(),
      Person.find({ userId, ...changedSince })
        .populate(PERSON_POPULATE)
        .lean(),
      Tag.find({ userId, ...changedSince }).lean(),
      Thread.find({ userId, ...changedSince }).lean(),
      getSettings(userId),
      // A full state names every doc that exists; the ones it doesn't name are the deletions.
      reset ? Promise.resolve([]) : Deletion.find({ userId, deletedAt: { $gt: cursor } }).lean(),
    ]);

    const response: SyncResponse = {
      serverTime,
      reset,
      entries: (entries as unknown as LeanEntry[]).map(entryToDto),
      people: (people as unknown as LeanPerson[]).map(personToDto),
      tags: (tags as unknown as LeanTag[]).map(tagToDto),
      threads: (threads as unknown as LeanThread[]).map(threadToDto),
      settings,
      deletions: (deletions as unknown as LeanDeletion[]).map((d) => ({
        coll: d.coll,
        docId: d.docId.toString(),
        deletedAt: d.deletedAt.toISOString(),
      })),
    };
    return c.json(response);
  });
