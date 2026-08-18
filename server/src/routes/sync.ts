import type { SyncCollection, SyncResponse } from '@diary/shared';
import { syncQuerySchema } from '@diary/shared';
import { Hono } from 'hono';
import type { Types } from 'mongoose';
import type { AppEnv } from '../middleware/session';
import { queryValidator } from '../middleware/validate';
import { trackEvent, userHash } from '../lib/telemetry';
import { Deletion, isCursorStale } from '../models/deletion';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { PluginDocument } from '../models/pluginDocument';
import { PluginRecord } from '../models/pluginRecord';
import { Tag } from '../models/tag';
import { Thread } from '../models/thread';
import { issueWsTicket } from '../services/liveSync';
import { getSettings } from '../services/settingsService';
import {
  ENTRY_POPULATE,
  entryToDto,
  personToDto,
  pluginDocumentToDto,
  pluginRecordToDto,
  tagToDto,
  threadToDto,
  type LeanEntry,
  type LeanPerson,
  type LeanPluginDocument,
  type LeanPluginRecord,
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

    const queryStartedAt = performance.now();
    const [entries, people, tags, threads, pluginRecords, pluginDocuments, settings, deletions] =
      await Promise.all([
        Entry.find({ userId, ...changedSince })
          .populate(ENTRY_POPULATE)
          .lean(),
        Person.find({ userId, ...changedSince })
          .populate(PERSON_POPULATE)
          .lean(),
        Tag.find({ userId, ...changedSince }).lean(),
        Thread.find({ userId, ...changedSince }).lean(),
        /* The two collections whose deltas are served by a real index on updatedAt rather than a
           userId-prefix scan — see the note on the index in models/pluginRecord, which applies to
           documents for the same reason and rather more strongly: a revision row per document per
           day outgrows a diary faster than a habit row per day does. */
        PluginRecord.find({ userId, ...changedSince }).lean(),
        PluginDocument.find({ userId, ...changedSince }).lean(),
        getSettings(userId),
        // A full state names every doc that exists; the ones it doesn't name are the deletions.
        reset ? Promise.resolve([]) : Deletion.find({ userId, deletedAt: { $gt: cursor } }).lean(),
      ]);

    const queryMs = Math.round(performance.now() - queryStartedAt);

    /* The one endpoint whose *cost* is not proportional to what the caller asked for.
       A delta is six indexed range queries returning almost nothing; a reset is the same six
       returning the user's entire diary, populated, in one response — and it is chosen by the
       server, not requested by the client. So it is reported here in full, never sampled, with the
       number that decides whether the cost is acceptable: how old the cursor was that triggered it.

       This is also the other half of the client's own `sync_reset`. That event says how many local
       documents the reset deleted; this one says why the server refused the delta and what it cost
       to answer. Joined on `client_id`, the pair is the complete account of the riskiest thing this
       system does — and neither end could tell the story alone. */
    if (reset) {
      trackEvent('sync_reset_served', {
        user: userHash(userId),
        client_id: c.req.header('x-client-id'),
        // Absent means a first sync (no cursor at all), which is the cheap, expected case and the
        // one to exclude when asking how often tombstone retention is actually being outrun.
        cursor_age_ms: cursor ? now.getTime() - cursor.getTime() : undefined,
        first_sync: !cursor,
        entries: entries.length,
        people: people.length,
        tags: tags.length,
        threads: threads.length,
        plugin_records: pluginRecords.length,
        /* Reported separately from plugin_records, not folded in. A reset's cost is bytes as much as
           rows here — one document row can be a quarter of a megabyte, where a record row is capped
           at four kilobytes — so a count that mixed the two would hide the expensive half. */
        plugin_documents: pluginDocuments.length,
        query_ms: queryMs,
      });
    } else if (queryMs >= 250) {
      // Deltas are supposed to be cheap. One that isn't means a user whose recent-change volume
      // has outgrown the assumption, and it is the early warning for the reset above.
      trackEvent('sync_delta_slow', {
        user: userHash(userId),
        query_ms: queryMs,
        changed:
          entries.length +
          people.length +
          tags.length +
          threads.length +
          pluginRecords.length +
          pluginDocuments.length,
        deletions: deletions.length,
      });
    }

    const response: SyncResponse = {
      serverTime,
      reset,
      entries: (entries as unknown as LeanEntry[]).map(entryToDto),
      people: (people as unknown as LeanPerson[]).map(personToDto),
      tags: (tags as unknown as LeanTag[]).map(tagToDto),
      threads: (threads as unknown as LeanThread[]).map(threadToDto),
      /* Always sent, never omitted when empty. Under `reset` the client deletes every local id the
         response did not name, so "absent" and "none" must not look alike — a client reading
         absence as emptiness would delete the account's entire plugin history. The client's own
         tolerance for a server that predates this field is to skip the sweep, not to run it. */
      pluginRecords: (pluginRecords as unknown as LeanPluginRecord[]).map(pluginRecordToDto),
      /* Always sent, never omitted when empty — for the reason spelled out on pluginRecords just
         above, which applies to every collection added after a client shipped. */
      pluginDocuments: (pluginDocuments as unknown as LeanPluginDocument[]).map(
        pluginDocumentToDto,
      ),
      settings,
      deletions: (deletions as unknown as LeanDeletion[]).map((d) => ({
        coll: d.coll,
        docId: d.docId.toString(),
        deletedAt: d.deletedAt.toISOString(),
      })),
    };
    return c.json(response);
  });
