import 'fake-indexeddb/auto';
import type { EntryDto, SyncResponse } from '@diary/shared';
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

const apiGet = vi.fn();
vi.mock('@/lib/apiClient', () => ({
  API_BASE: '',
  CLIENT_ID: 'test-client',
  api: vi.fn(),
  apiGet: (path: string) => apiGet(path) as unknown,
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
vi.mock('@/lib/sessionCache', () => ({ getCachedUser: () => ({ id: 'u1' }) }));
vi.mock('@/lib/preferences', () => ({ getPreferences: () => ({ syncOnWifiOnly: false }) }));
vi.mock('@/lib/network', () => ({ isMeteredConnection: () => false }));

const { db } = await import('./db');
const { syncNow } = await import('./sync');

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

const syncResponse = (patch: Partial<SyncResponse>): SyncResponse => ({
  serverTime: '2026-08-07T10:00:05.000Z',
  entries: [],
  people: [],
  tags: [],
  threads: [],
  settings: DEFAULT_SETTINGS,
  deletions: [],
  ...patch,
});

beforeEach(async () => {
  apiGet.mockReset();
  await Promise.all([db.entries.clear(), db.tags.clear(), db.outbox.clear(), db.meta.clear()]);
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
    apiGet.mockResolvedValue(
      syncResponse({ deletions: [{ coll: 'tag', docId: 't1', deletedAt: DELETED_AT }] }),
    );

    await syncNow();

    expect(await db.tags.get('t1')).toBeUndefined();
  });
});
