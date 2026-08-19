import 'fake-indexeddb/auto';
import type { EntryDto, PluginDocumentDto, PluginRecordDto, SyncResponse } from '@diary/shared';
import { DEFAULT_SETTINGS } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* What a pull does with a tombstone.

   The interesting case is undo. Deleting an entry leaves a tombstone on the server, and undo
   re-creates the entry under its *original* id — so until the tombstone is retracted the server
   holds two contradictory facts about one id, and a pull with a cursor older than the delete
   receives both of them in the same response. Applying the deletion unconditionally (as this used
   to) deleted the row the same sync had just restored, and the entry vanished again seconds after
   the undo appeared to work. */

// The module reads navigator.onLine at import time and on every run; node's navigator has no such
// field, so without this every sync would short-circuit as offline.
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
  writable: true,
});

/* Hoisted so the tests can drive the same objects the mocks hand to the module under test —
   `vi.mock` factories are lifted above the imports, so they cannot close over ordinary consts. */
const { apiGet, apiCall, ApiErrorMock, prefs, network } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiCall: vi.fn(),
  ApiErrorMock: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
  prefs: { syncOnWifiOnly: false },
  network: { metered: false },
}));

vi.mock('@/lib/apiClient', () => ({
  API_BASE: '',
  CLIENT_ID: 'test-client',
  api: (path: string, init: unknown) => apiCall(path, init) as unknown,
  apiGet: (path: string) => apiGet(path) as unknown,
  ApiError: ApiErrorMock,
}));
vi.mock('@/lib/sessionCache', () => ({ getCachedUser: () => ({ id: 'u1' }) }));
vi.mock('@/lib/preferences', () => ({
  getPreferences: () => prefs,
  subscribePreferences: () => () => {},
}));
vi.mock('@/lib/network', () => ({ isMeteredConnection: () => network.metered }));

const { db, entryFromDto, setMeta } = await import('./db');
const {
  forceSyncNow,
  getSyncStatus,
  onDocumentsMerged,
  onRejected,
  onSyncApplied,
  syncNow,
  waitForOutboxDrain,
} = await import('./sync');

const DELETED_AT = '2026-08-07T10:00:00.000Z';
const RESTORED_AT = '2026-08-07T10:00:03.000Z';

const entryDto = (id: string): EntryDto => ({
  id,
  content: 'called Carmen about the trip',
  dateKey: '2026-08-07',
  importance: 3,
  tags: [],
  people: [],
  threads: [],
  saidTo: [],
  hiddenFor: [],
  parentId: null,
  orderKey: 'a0',
  createdAt: '2026-08-07T09:00:00.000Z',
  updatedAt: RESTORED_AT,
});

const pluginRecordDto = (id: string, patch: Partial<PluginRecordDto> = {}): PluginRecordDto => ({
  id,
  pluginId: 'habits',
  scope: 'record',
  dateKey: '2026-08-07',
  data: {},
  createdAt: '2026-08-07T09:00:00.000Z',
  updatedAt: RESTORED_AT,
  ...patch,
});

const syncResponse = (patch: Partial<SyncResponse>): SyncResponse => ({
  serverTime: '2026-08-07T10:00:05.000Z',
  // Defaults to a delta, which is what all but the reset block below is about. The server sets it
  // the other way for a first sync; here every test that wants a full state says so.
  reset: false,
  entries: [],
  people: [],
  tags: [],
  threads: [],
  pluginRecords: [],
  pluginDocuments: [],
  settings: DEFAULT_SETTINGS,
  deletions: [],
  ...patch,
});

/**
 * Wait until no sync pass is running, or until it is clear one never will be.
 *
 * A merge queues a write and kicks, so a pass started from inside another pass outlives the test
 * that caused it. Two things go wrong if it is still going when the next test starts: it fails
 * partway through against mocks that have since been reset (noise), and — the one that actually
 * breaks assertions — the next `syncNow()` is *coalesced* into it and never sends anything of its
 * own. Three consecutive quiet ticks rather than one, because `run` clears `syncing` in a `finally`
 * a microtask before the follow-up sets it again.
 */
const settle = async () => {
  for (let quiet = 0, ticks = 0; quiet < 3 && ticks < 200; ticks++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    quiet = getSyncStatus().syncing ? 0 : quiet + 1;
  }
};

beforeEach(async () => {
  await settle();
  apiGet.mockReset();
  apiCall.mockReset();
  prefs.syncOnWifiOnly = false;
  network.metered = false;
  await Promise.all([
    // Every synced table, not just the two the tombstone cases use: a reset prunes all of them,
    // so a row left behind by an earlier test would be deleted by a later one.
    db.entries.clear(),
    db.people.clear(),
    db.tags.clear(),
    db.threads.clear(),
    db.pluginRecords.clear(),
    db.pluginDocuments.clear(),
    db.pluginDocumentBases.clear(),
    db.outbox.clear(),
    db.deadLetter.clear(),
    db.meta.clear(),
  ]);
});

describe('pull: tombstones', () => {
  it('keeps a doc the same response also sent back alive (undo re-created it)', async () => {
    // The state right after an undo drained: the entry is local again, and the server has both
    // the re-created entry and the not-yet-retracted tombstone from the delete that preceded it.
    await db.entries.put({
      id: 'e1',
      content: 'called Carmen about the trip',
      dateKey: '2026-08-07',
      importance: 3,
      tagIds: [],
      peopleIds: [],
      threadIds: [],
      saidTo: [],
      hiddenFor: [],
      parentId: null,
      orderKey: 'a0',
      createdAt: '2026-08-07T09:00:00.000Z',
      updatedAt: RESTORED_AT,
    });
    apiGet.mockResolvedValue(
      syncResponse({
        entries: [entryDto('e1')],
        deletions: [{ coll: 'entry', docId: 'e1', deletedAt: DELETED_AT }],
      }),
    );

    await syncNow();

    expect(await db.entries.get('e1')).toBeDefined();
  });

  it('still applies a tombstone for a doc the server no longer has', async () => {
    await db.entries.put({
      id: 'e2',
      content: 'deleted on the phone',
      dateKey: '2026-08-07',
      importance: 3,
      tagIds: [],
      peopleIds: [],
      threadIds: [],
      saidTo: [],
      hiddenFor: [],
      parentId: null,
      orderKey: 'a0',
      createdAt: '2026-08-07T09:00:00.000Z',
      updatedAt: '2026-08-07T09:00:00.000Z',
    });
    apiGet.mockResolvedValue(
      syncResponse({ deletions: [{ coll: 'entry', docId: 'e2', deletedAt: DELETED_AT }] }),
    );

    await syncNow();

    expect(await db.entries.get('e2')).toBeUndefined();
  });

  it('applies tombstones across every collection', async () => {
    await db.tags.put({ id: 't1', name: 'travel', color: '#fff' });
    await db.pluginRecords.put(pluginRecordDto('pr1'));
    apiGet.mockResolvedValue(
      syncResponse({
        deletions: [
          { coll: 'tag', docId: 't1', deletedAt: DELETED_AT },
          { coll: 'pluginRecord', docId: 'pr1', deletedAt: DELETED_AT },
        ],
      }),
    );

    await syncNow();

    expect(await db.tags.get('t1')).toBeUndefined();
    expect(await db.pluginRecords.get('pr1')).toBeUndefined();
  });
});

/* Plugin records ride the same machinery as everything else, which is the point of the shared
   collection — but they were the reason two of its rules had to be tightened, and those are what
   these pin. */
describe('pull: plugin records', () => {
  it('does not resurrect a row whose delete is still queued', async () => {
    /* The case that decided the route's shape. A queued DELETE carries no body, so the only place
       its document id can be read from is the path — and dirtyIds takes the *second* segment. Under
       a nested /plugins/habits/records/:id that segment would be 'habits', the real id would never
       enter the dirty set, and this pull would put the deleted row straight back.

       Queued from inside the fetch, because a pull only runs once the outbox has drained: this is
       the in-flight window the dirty set exists for. */
    apiGet.mockImplementation(async () => {
      await db.outbox.add({ method: 'DELETE', path: '/plugin-records/pr2', body: undefined });
      return syncResponse({ pluginRecords: [pluginRecordDto('pr2')] });
    });

    await syncNow();

    expect(await db.pluginRecords.get('pr2')).toBeUndefined();
  });

  it('drops the phantom local row when a create comes back conflicted', async () => {
    // 409: this plugin already has a config row under another id — two devices enabled it offline.
    // The local create never reached the server, so the row it wrote is a phantom.
    await db.pluginRecords.put(pluginRecordDto('pr3', { scope: 'config' }));
    await db.outbox.add({
      method: 'POST',
      path: '/plugin-records',
      body: { id: 'pr3', pluginId: 'habits', scope: 'config', data: { enabled: true } },
    });
    apiCall.mockRejectedValueOnce(new ApiErrorMock(409, 'pluginRecord.duplicate_config'));
    apiGet.mockResolvedValue(syncResponse({}));

    await syncNow();

    expect(await db.pluginRecords.get('pr3')).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it('does NOT sweep plugin records when the server never mentioned them', async () => {
    /* A staggered deploy: a client that knows about plugin records talking to a server that does
       not. `res.pluginRecords` is undefined, which must NOT be read as "the account owns none" —
       under reset that would delete the entire plugin history, silently and successfully.

       The same rule now covers threads, which carried this hazard latently before plugins existed. */
    await db.pluginRecords.put(pluginRecordDto('pr4'));
    await db.threads.put({
      id: 'th4',
      name: 'Job hunt',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const { pluginRecords, threads, ...withoutEither } = syncResponse({ reset: true });
    void pluginRecords;
    void threads;
    apiGet.mockResolvedValue(withoutEither);

    await syncNow();

    expect(await db.pluginRecords.get('pr4')).toBeDefined();
    expect(await db.threads.get('th4')).toBeDefined();
  });

  it('does sweep them once the server does mention them', async () => {
    // The other half of the rule: an acknowledged-but-empty collection prunes exactly as before.
    await db.pluginRecords.put(pluginRecordDto('pr5'));
    apiGet.mockResolvedValue(syncResponse({ reset: true, pluginRecords: [] }));

    await syncNow();

    expect(await db.pluginRecords.get('pr5')).toBeUndefined();
  });
});

/* Tombstones don't live forever — past TOMBSTONE_RETENTION_DAYS the server prunes them, and a
   device whose cursor predates that can no longer be told what it missed by a delta. The server
   answers such a pull with the complete state and `reset: true`, and the deletes are then carried
   by the ids it doesn't mention. Which makes absence load-bearing, and that is the danger: read the
   same way on an ordinary delta — which only ever names what changed — it would empty the diary. */
describe('pull: reset', () => {
  it('removes a local doc the full state does not contain', async () => {
    await db.entries.put(entryFromDto(entryDto('e5')));
    await db.tags.put({ id: 't5', name: 'travel', color: '#fff' });
    // No tombstone anywhere in this response: the one for e5 was pruned long ago.
    apiGet.mockResolvedValue(
      syncResponse({ reset: true, tags: [{ id: 't5', name: 'travel', color: '#fff' }] }),
    );

    await syncNow();

    expect(await db.entries.get('e5')).toBeUndefined();
    expect(await db.tags.get('t5')).toBeDefined(); // named by the dump, so still alive
  });

  it('keeps a doc written while the pull was in flight', async () => {
    /* The dangerous ordering: the outbox drained, the pull left, and only then did someone write a
       note. The server's answer was composed before it existed, so the dump cannot name it — and
       under this branch "not in the dump" otherwise means "delete". Being in the outbox is the only
       thing that saves it, which is why the outbox is read inside the same transaction. */
    apiGet.mockImplementation(async () => {
      await db.entries.put(entryFromDto(entryDto('e6')));
      await db.outbox.add({ method: 'POST', path: '/entries', body: { id: 'e6' } });
      return syncResponse({ reset: true });
    });

    await syncNow();

    expect(await db.entries.get('e6')).toBeDefined();
  });

  it('leaves unmentioned docs alone on an ordinary delta', async () => {
    // The regression that would cost someone their diary: a quiet minute's delta names nothing.
    await db.entries.put(entryFromDto(entryDto('e7')));
    apiGet.mockResolvedValue(syncResponse({ reset: false }));

    await syncNow();

    expect(await db.entries.get('e7')).toBeDefined();
  });

  it('treats a cursored response from a server that predates `reset` as a delta', async () => {
    await setMeta('syncCursor', '2026-08-01T00:00:00.000Z');
    await db.entries.put(entryFromDto(entryDto('e8')));
    const { reset: _omitted, ...withoutReset } = syncResponse({});
    apiGet.mockResolvedValue(withoutReset);

    await syncNow();

    expect(await db.entries.get('e8')).toBeDefined();
  });
});

/* A write the server refuses outright has to leave the queue — leaving it there would jam every
   later write behind it forever. What it must not do is leave without a trace: the local copy
   still shows the change as saved, so a silent drop is a divergence the user cannot discover. */
describe('push: a rejected write', () => {
  it('drains from the queue but is kept, and announced once', async () => {
    await db.outbox.add({ method: 'PATCH', path: '/entries/e1', body: { id: 'e1' } });
    apiCall.mockRejectedValueOnce(new ApiErrorMock(422, 'validation'));
    apiGet.mockResolvedValue(syncResponse({}));
    const announced: number[] = [];
    const off = onRejected((count) => announced.push(count));

    await syncNow();
    off();

    expect(await db.outbox.count()).toBe(0);
    expect(await db.deadLetter.toArray()).toMatchObject([
      { method: 'PATCH', path: '/entries/e1', status: 422, code: 'validation' },
    ]);
    expect(announced).toEqual([1]);
  });

  it('leaves a 404 on a PATCH alone — already gone is not a loss', async () => {
    await db.outbox.add({ method: 'PATCH', path: '/entries/e2', body: { id: 'e2' } });
    apiCall.mockRejectedValueOnce(new ApiErrorMock(404, 'entry.not_found'));
    apiGet.mockResolvedValue(syncResponse({}));

    await syncNow();

    expect(await db.outbox.count()).toBe(0);
    expect(await db.deadLetter.count()).toBe(0);
  });

  it('keeps a 404 on a create — an entry the server refused is a real loss', async () => {
    await db.outbox.add({ method: 'POST', path: '/entries', body: { id: 'e3' } });
    apiCall.mockRejectedValueOnce(new ApiErrorMock(404, 'entry.not_found'));
    apiGet.mockResolvedValue(syncResponse({}));

    await syncNow();

    // The local copy still shows it as saved, so a silent drop would be a divergence the user
    // could only discover on another device, months later or never.
    expect(await db.deadLetter.count()).toBe(1);
  });

  it('tolerates a 404 on a create the backup importer queued', async () => {
    /* Restoring a file written months ago legitimately posts things whose parent has since been
       deleted. Nothing is lost — the target was gone before the restore began — so reporting it as
       an unsaved change would be reporting data loss for data deleted on purpose. */
    await db.outbox.add({
      method: 'POST',
      path: '/entries',
      body: { id: 'e4' },
      tolerate404: true,
    });
    apiCall.mockRejectedValueOnce(new ApiErrorMock(404, 'entry.not_found'));
    apiGet.mockResolvedValue(syncResponse({}));
    const announced: number[] = [];
    const off = onRejected((count) => announced.push(count));

    await syncNow();
    off();

    expect(await db.outbox.count()).toBe(0);
    expect(await db.deadLetter.count()).toBe(0);
    expect(announced).toEqual([]); // and no "N changes couldn't be saved" toast
  });

  it('still dead-letters a tolerated op the server refused for another reason', async () => {
    // `tolerate404` forgives exactly one status. A 422 is still a write the server threw away.
    await db.outbox.add({
      method: 'POST',
      path: '/entries',
      body: { id: 'e5' },
      tolerate404: true,
    });
    apiCall.mockRejectedValueOnce(new ApiErrorMock(422, 'validation'));
    apiGet.mockResolvedValue(syncResponse({}));

    await syncNow();

    expect(await db.deadLetter.count()).toBe(1);
  });
});

/* Restoring a backup is the one flow that waits for the network instead of merely tolerating it:
   it queues thousands of writes at once, and it is the action people take precisely because they
   are anxious about their data. */
describe('waiting for the outbox to drain', () => {
  it('resolves at once when there is nothing queued', async () => {
    await expect(waitForOutboxDrain()).resolves.toBe('drained');
  });

  it('resolves once the queue empties', async () => {
    await db.outbox.add({ method: 'POST', path: '/tags', body: { id: 't9' } });
    apiCall.mockResolvedValue(undefined);
    apiGet.mockResolvedValue(syncResponse({}));

    const waiting = waitForOutboxDrain();
    await syncNow();

    await expect(waiting).resolves.toBe('drained');
  });

  it('gives up as soon as the queue is blocked, rather than hanging', async () => {
    await db.outbox.add({ method: 'POST', path: '/tags', body: { id: 't10' } });
    apiCall.mockRejectedValue(new ApiErrorMock(0, 'offline'));

    const waiting = waitForOutboxDrain();
    await syncNow();

    /* 'blocked', not an error: the writes are safe in the outbox and will replay. The caller's job
       is to say "this will finish later", which is a different sentence from "this failed". */
    await expect(waiting).resolves.toBe('blocked');
    expect(await db.outbox.count()).toBe(1);
  });
});

/* A pull runs every 60 seconds whether or not anything changed, and announcing one invalidates the
   whole query cache and re-runs every read on screen — several of which walk a table. On an idle
   app that used to be the entire cost of the app, paid on a timer to arrive back where it started.
   So the announcement is now a statement about data, and an empty delta has nothing to say. */
describe('pull: announcing only what arrived', () => {
  const countAnnouncements = async (response: Partial<SyncResponse>) => {
    apiGet.mockResolvedValue(syncResponse(response));
    let announced = 0;
    const off = onSyncApplied(() => announced++);
    await syncNow();
    off();
    return announced;
  };

  it('stays quiet when the server had nothing to send', async () => {
    await setMeta('syncCursor', '2026-08-01T00:00:00.000Z');
    await setMeta('settings', DEFAULT_SETTINGS);

    expect(await countAnnouncements({})).toBe(0);
  });

  it('announces a delta that carried a document', async () => {
    await setMeta('syncCursor', '2026-08-01T00:00:00.000Z');
    await setMeta('settings', DEFAULT_SETTINGS);

    expect(await countAnnouncements({ entries: [entryDto('e10')] })).toBe(1);
  });

  it('announces a tombstone, which carries no document at all', async () => {
    await setMeta('syncCursor', '2026-08-01T00:00:00.000Z');
    await setMeta('settings', DEFAULT_SETTINGS);
    const deletions = [{ coll: 'entry' as const, docId: 'gone', deletedAt: DELETED_AT }];

    expect(await countAnnouncements({ deletions })).toBe(1);
  });

  it('announces a settings change made on another device', async () => {
    /* Settings ride along on every pull regardless of the cursor — the server has no changed-since
       filter for a singleton — so presence can't mean "changed" here the way it does above. */
    await setMeta('syncCursor', '2026-08-01T00:00:00.000Z');
    await setMeta('settings', { ...DEFAULT_SETTINGS, talkingPointsLimit: 10 });

    expect(await countAnnouncements({})).toBe(1);
  });

  it('announces a reset, which is a change even when the server is empty', async () => {
    await setMeta('settings', DEFAULT_SETTINGS);

    expect(await countAnnouncements({ reset: true })).toBe(1);
  });
});

/* Kept, but not without end. Nothing empties this table short of a sign-out, and a write the
   server rejects *systematically* lands one row per attempt for as long as the app is installed. */
describe('dead letter: bounded', () => {
  /** Drive one rejection through, which is what triggers the trim. */
  const rejectOnce = async () => {
    await db.outbox.add({ method: 'PATCH', path: '/entries/x', body: { id: 'x' } });
    apiCall.mockRejectedValueOnce(new ApiErrorMock(422, 'validation'));
    apiGet.mockResolvedValue(syncResponse({}));
    await syncNow();
  };

  const deadLetterRow = (failedAt: string) => ({
    method: 'PATCH' as const,
    path: '/entries/old',
    status: 422,
    code: 'validation',
    failedAt,
  });

  it('keeps only the newest once past the count cap', async () => {
    // Timestamps ascending, so "the newest 200" is a fact the assertion can name.
    await db.deadLetter.bulkAdd(
      Array.from({ length: 250 }, (_, i) =>
        deadLetterRow(new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString()),
      ),
    );

    await rejectOnce();

    expect(await db.deadLetter.count()).toBe(200);
    const oldest = await db.deadLetter.orderBy('failedAt').first();
    expect(oldest!.failedAt).toBe(new Date(Date.UTC(2026, 7, 1, 0, 51)).toISOString());
  });

  it('drops rows older than the age cap', async () => {
    const ancient = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await db.deadLetter.bulkAdd([deadLetterRow(ancient), deadLetterRow(recent)]);

    await rejectOnce();

    const kept = (await db.deadLetter.toArray()).map((row) => row.failedAt);
    expect(kept).not.toContain(ancient);
    expect(kept).toContain(recent);
  });
});

/* A kick fires on every mutation, every foreground and every minute. run() used to open by
   clearing the blocker optimistically, so each of those made the pill vanish and come back a
   second later when the request finally failed — the one status the user most needs to trust,
   blinking. A blocker now outlives an attempt that hasn't concluded. */
describe('status: no flicker while retrying', () => {
  it('keeps reporting an unreachable server for the whole of the next attempt', async () => {
    apiGet.mockRejectedValue(new ApiErrorMock(0, 'errors.offline'));
    await syncNow();
    expect(getSyncStatus().blocker).toBe('unreachable');

    // Hold the retry open: mid-flight is not evidence about its own outcome.
    let fail!: () => void;
    apiGet.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = () => reject(new ApiErrorMock(0, 'errors.offline'));
        }),
    );
    const attempt = syncNow();
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));

    expect(getSyncStatus().syncing).toBe(true);
    expect(getSyncStatus().blocker).toBe('unreachable');

    fail();
    await attempt;
    expect(getSyncStatus().blocker).toBe('unreachable');
  });

  it('clears only once a pull has actually completed', async () => {
    apiGet.mockRejectedValueOnce(new ApiErrorMock(0, 'errors.offline'));
    await syncNow();
    expect(getSyncStatus().blocker).toBe('unreachable');

    apiGet.mockResolvedValue(syncResponse({}));
    await syncNow();
    expect(getSyncStatus().blocker).toBeNull();
  });

  it('treats an answer from the server as reachable, even a refusal', async () => {
    apiGet.mockRejectedValueOnce(new ApiErrorMock(0, 'errors.offline'));
    await syncNow();
    expect(getSyncStatus().blocker).toBe('unreachable');

    // 400 means it composed a reply and sent it: whatever is wrong, it is not the connection.
    apiGet.mockRejectedValueOnce(new ApiErrorMock(400, 'validation'));
    await syncNow();
    expect(getSyncStatus().blocker).toBeNull();
  });
});

/* "Sync on Wi-Fi only" used to return from syncNow in silence, leaving the status untouched — so
   the app looked fully synced while the outbox grew behind it. */
describe('wi-fi-only', () => {
  it('says it is waiting, and keeps the pending count live', async () => {
    await db.outbox.add({ method: 'POST', path: '/entries', body: { id: 'e3' } });
    prefs.syncOnWifiOnly = true;
    network.metered = true;

    await syncNow();

    expect(getSyncStatus().blocker).toBe('paused');
    expect(apiCall).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(getSyncStatus().pending).toBe(1));
  });

  it('syncs anyway when the user asks it to', async () => {
    await db.outbox.add({ method: 'POST', path: '/entries', body: { id: 'e4' } });
    prefs.syncOnWifiOnly = true;
    network.metered = true;
    apiGet.mockResolvedValue(syncResponse({}));

    await forceSyncNow();

    expect(apiCall).toHaveBeenCalledOnce();
    expect(await db.outbox.count()).toBe(0);
    expect(getSyncStatus().blocker).toBeNull();
  });
});

/* Two devices, one document.
 *
 * A `body` is a whole page of prose in one field, so the ordinary sync rule — the server's row
 * wins — means whichever device syncs last is the one that wrote today. These are the tests for the
 * machinery that replaced it: a merge base captured on the first local edit, a conditional write
 * the server can refuse, and a three-way merge on the way back in.
 */
describe('pull: two devices writing one document', () => {
  const DOC_ID = 'd1';
  const SERVER_AT = '2026-08-07T09:30:00.000Z';
  const THEIR_WRITE_AT = '2026-08-07T09:32:00.000Z';

  const documentDto = (body: string, updatedAt = SERVER_AT): PluginDocumentDto => ({
    id: DOC_ID,
    pluginId: 'notebook',
    dateKey: '',
    documentId: '',
    parentId: '',
    title: 'A thought',
    body,
    sortKey: 'a0',
    added: 0,
    removed: 0,
    createdAt: '2026-08-07T09:00:00.000Z',
    updatedAt,
  });

  /** The state of a device that edited a document and has not yet had the edit acknowledged. */
  const editedLocally = async (was: string, now: string) => {
    await db.pluginDocuments.put(documentDto(now, '2026-08-07T09:31:00.000Z'));
    await db.pluginDocumentBases.put({ id: DOC_ID, text: was, version: SERVER_AT });
  };

  const BASE = 'Met Ana for coffee. She is moving in June.';
  const OURS = 'Met Ana for coffee at the market. She is moving in June.';
  const THEIRS = 'Met Ana for coffee. She is moving in June. I should help her pack.';
  const MERGED = 'Met Ana for coffee at the market. She is moving in June. I should help her pack.';

  /* Only the first pull of a test carries their write. A merge queues a write and kicks a sync, so
     a second pass follows every merging test; leaving the same response standing would have that
     pass merge the same row again, which is a loop no real server could produce (it would have
     answered with the merged text by then) and pure noise here. */
  const theyWrote = (body: string) =>
    apiGet.mockResolvedValueOnce(
      syncResponse({ pluginDocuments: [documentDto(body, THEIR_WRITE_AT)] }),
    );

  beforeEach(() => {
    apiGet.mockResolvedValue(syncResponse({}));
    apiCall.mockResolvedValue({});
  });

  it('merges the other device edit into ours instead of overwriting it', async () => {
    await editedLocally(BASE, OURS);
    theyWrote(THEIRS);

    await syncNow();

    expect((await db.pluginDocuments.get(DOC_ID))?.body).toBe(MERGED);
  });

  /* The merged text is a version the server has never seen, so it goes straight back up — carrying
     the version it was merged against, so that a third write landing in between is refused rather
     than clobbered. This is the second half of the `git pull` loop, and the half that makes the
     other device see the merge. */
  it('sends the merged text back, conditional on the version it merged against', async () => {
    await editedLocally(BASE, OURS);
    theyWrote(THEIRS);

    await syncNow();
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));

    const sent = apiCall.mock.calls.find(([path]) => path === `/plugin-documents/${DOC_ID}`) as [
      string,
      { body: string },
    ];
    expect(JSON.parse(sent[1].body)).toEqual({ body: MERGED, baseVersion: THEIR_WRITE_AT });
  });

  /* The ancestor moves onto what the server had, not onto the merge: the merge is *our* new work
     until the server acknowledges it, and the next round has to be able to tell the two apart. */
  it('moves the merge base onto the version it merged against', async () => {
    await editedLocally(BASE, OURS);
    theyWrote(THEIRS);

    await syncNow();

    expect(await db.pluginDocumentBases.get(DOC_ID)).toEqual({
      id: DOC_ID,
      text: THEIRS,
      version: THEIR_WRITE_AT,
    });
  });

  it('takes the server row untouched when this device has nothing in flight', async () => {
    await db.pluginDocuments.put(documentDto(BASE));
    apiGet.mockResolvedValue(syncResponse({ pluginDocuments: [documentDto(THEIRS)] }));

    await syncNow();

    expect((await db.pluginDocuments.get(DOC_ID))?.body).toBe(THEIRS);
    expect(await db.outbox.count()).toBe(0);
  });

  it('forgets the base and queues nothing when the pull brings our own text back', async () => {
    await editedLocally(BASE, OURS);
    theyWrote(OURS);

    await syncNow();

    expect(await db.pluginDocumentBases.get(DOC_ID)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  /* A revision's body is an encoded patch, not prose. Merging two encodings of a diff would produce
     neither one, so revisions take the ordinary overwrite path however much local work exists. */
  it('never merges a revision, whose body is a patch rather than prose', async () => {
    const revision: PluginDocumentDto = {
      ...documentDto('{"v":2,"ops":[["=",1]]}'),
      id: 'rev1',
      dateKey: '2026-08-07',
      documentId: DOC_ID,
    };
    await db.pluginDocuments.put({ ...revision, body: '{"v":2,"ops":[]}' });
    await db.pluginDocumentBases.put({ id: 'rev1', text: 'nonsense', version: SERVER_AT });
    apiGet.mockResolvedValue(syncResponse({ pluginDocuments: [revision] }));

    await syncNow();

    expect((await db.pluginDocuments.get('rev1'))?.body).toBe('{"v":2,"ops":[["=",1]]}');
  });

  it('reports a conflict so the UI can say both versions were kept', async () => {
    await editedLocally('Dinner at six.', 'Dinner at seven.');
    theyWrote('Dinner at eight.');
    let reported = 0;
    const off = onDocumentsMerged((count) => {
      reported = count;
    });

    await syncNow();
    off();

    expect(reported).toBe(1);
    const merged = (await db.pluginDocuments.get(DOC_ID))?.body ?? '';
    expect(merged).toContain('seven');
    expect(merged).toContain('eight');
  });

  it('says nothing when the merge was clean', async () => {
    await editedLocally(BASE, OURS);
    theyWrote(THEIRS);
    const merged = vi.fn();
    const off = onDocumentsMerged(merged);

    await syncNow();
    off();

    expect(merged).not.toHaveBeenCalled();
  });
});

describe('push: the conditional body write', () => {
  const DOC_ID = 'd9';
  const SERVER_AT = '2026-08-07T09:30:00.000Z';

  beforeEach(() => {
    apiGet.mockResolvedValue(syncResponse({}));
  });

  const queueBodyWrite = (body: string) =>
    db.outbox.add({ method: 'PATCH', path: `/plugin-documents/${DOC_ID}`, body: { body } });

  const sentBody = (call: number) => {
    const [, init] = apiCall.mock.calls[call] as [string, { body: string }];
    return JSON.parse(init.body) as Record<string, unknown>;
  };

  it('attaches the version this device last saw, which is never in the queued op', async () => {
    await db.pluginDocumentBases.put({ id: DOC_ID, text: 'Was.', version: SERVER_AT });
    await queueBodyWrite('Is.');
    apiGet.mockResolvedValue(syncResponse({}));
    apiCall.mockResolvedValue({ updatedAt: '2026-08-07T09:40:00.000Z' });

    await syncNow();

    expect(sentBody(0)).toEqual({ body: 'Is.', baseVersion: SERVER_AT });
  });

  /* The reason the precondition is read at send time. Typing queues a write every time it settles,
     and if each one carried the version from before the *first* of them, the first would land and
     every one after it would be refused by the guard meant to protect them. */
  it('carries the version the server just stamped into the next write, not the stale one', async () => {
    await db.pluginDocumentBases.put({ id: DOC_ID, text: 'Was.', version: SERVER_AT });
    await queueBodyWrite('First.');
    await queueBodyWrite('Second.');
    apiGet.mockResolvedValue(syncResponse({}));
    apiCall.mockResolvedValueOnce({ updatedAt: '2026-08-07T09:41:00.000Z' });
    apiCall.mockResolvedValue({ updatedAt: '2026-08-07T09:42:00.000Z' });

    await syncNow();

    expect(sentBody(1)).toEqual({ body: 'Second.', baseVersion: '2026-08-07T09:41:00.000Z' });
  });

  it('sends nothing conditional for a document with no unsynced work', async () => {
    await queueBodyWrite('Is.');
    apiGet.mockResolvedValue(syncResponse({}));
    apiCall.mockResolvedValue({ updatedAt: SERVER_AT });

    await syncNow();

    expect(sentBody(0)).toEqual({ body: 'Is.' });
    // And no base is invented from the reply: there was nothing in flight to track. A revision's
    // PATCH also carries a string `body`, and this is what keeps it out of the merge path.
    expect(await db.pluginDocumentBases.get(DOC_ID)).toBeUndefined();
  });

  /* A refused write is not a lost one. The text is still in Dexie and the base is still recorded,
     so the pull that follows this drained queue merges the two versions and queues the result —
     which is why this must not become a dead letter and tell the user a change wasn't saved. */
  it('drops a refused write without reporting it as data loss', async () => {
    await db.pluginDocumentBases.put({ id: DOC_ID, text: 'Was.', version: SERVER_AT });
    await queueBodyWrite('Is.');
    apiCall.mockRejectedValue(new ApiErrorMock(409, 'pluginDocument.stale_write'));
    apiGet.mockResolvedValue(syncResponse({}));
    const rejected = vi.fn();
    const off = onRejected(rejected);

    await syncNow();
    off();

    expect(await db.outbox.count()).toBe(0);
    expect(await db.deadLetter.count()).toBe(0);
    expect(rejected).not.toHaveBeenCalled();
    // The base survives, because it is what the merge on the next pull needs.
    expect(await db.pluginDocumentBases.get(DOC_ID)).toBeDefined();
  });
});
