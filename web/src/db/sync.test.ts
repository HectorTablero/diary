import 'fake-indexeddb/auto';
import type { EntryDto, PluginRecordDto, SyncResponse } from '@diary/shared';
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
const { forceSyncNow, getSyncStatus, onRejected, onSyncApplied, syncNow, waitForOutboxDrain } =
  await import('./sync');

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

beforeEach(async () => {
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
