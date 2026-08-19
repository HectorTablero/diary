import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  doc,
  duplicateKeyError,
  modelDouble,
  objectId,
  oid,
  query,
  resetModels,
} from '../test/mongooseDouble';
import { postJson, routeApp, USER_ID } from '../test/routeApp';

/* The collection that holds prose, and therefore the only one where "the newer write wins" is not
 * good enough. A `body` is a whole page of text in one field, so an unconditional PATCH of it means
 * whichever of the user's devices synced last is the one that wrote today — and the other version
 * is gone, with nothing anywhere recording that it existed.
 *
 * `baseVersion` is what closes that: a write says which version of the row it was built on, and the
 * server refuses it if the row has moved since. The client then merges and tries again. So the
 * tests here are mostly about that one field — that it guards, that it is stripped rather than
 * stored, and that "refused" and "gone" come back as different answers, because the client does
 * different things with them.
 */

const PluginDocument = modelDouble();
const caps = vi.hoisted(() => ({ exceeded: vi.fn(async () => null as string | null) }));
const deletions = vi.hoisted(() => ({
  record: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
}));

vi.mock('../models/pluginDocument', () => ({
  PluginDocument,
  pluginDocumentCapExceeded: caps.exceeded,
}));
vi.mock('../models/deletion', () => ({
  recordDeletions: deletions.record,
  clearDeletions: deletions.clear,
}));

const { pluginDocumentsRouter } = await import('./pluginDocuments');

const app = routeApp('/plugin-documents', pluginDocumentsRouter);

const DOC_ID = oid('doc1');
const NOW = new Date('2026-08-18T09:00:00.000Z');
const LATER = new Date('2026-08-18T09:05:00.000Z');

const leanDocument = (patch: Record<string, unknown> = {}) => ({
  _id: objectId('doc1'),
  pluginId: 'notebook',
  dateKey: '',
  documentId: '',
  parentId: '',
  title: 'A thought',
  body: 'One sentence. Two sentences.',
  sortKey: 'a0',
  added: 0,
  removed: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
});

const patchJson = (path: string, body: unknown) => postJson(app, path, body, 'PATCH');

beforeEach(() => {
  resetModels(PluginDocument);
  caps.exceeded.mockClear().mockResolvedValue(null);
  deletions.record.mockClear();
  deletions.clear.mockClear();
});

describe('PATCH /plugin-documents/:id — the conditional body write', () => {
  it('puts the stated version in the filter, so a row that moved cannot be overwritten', async () => {
    PluginDocument.findOneAndUpdate.mockReturnValue(
      query(leanDocument({ body: 'New text.', updatedAt: LATER })),
    );

    const res = await patchJson(`/plugin-documents/${DOC_ID}`, {
      body: 'New text.',
      baseVersion: NOW.toISOString(),
    });

    expect(res.status).toBe(200);
    const [filter, update] = PluginDocument.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({ _id: DOC_ID, userId: USER_ID, updatedAt: NOW });
    /* Stripped, not stored. It describes the write rather than the row, and a `baseVersion` field
       landing in the document would sync back out to every device as part of the prose row. */
    expect(update).toEqual({ $set: { body: 'New text.' } });
  });

  it('refuses a write built on a version the row has moved past', async () => {
    // The update matched nothing, and the row is still there: somebody else's write landed first.
    PluginDocument.findOneAndUpdate.mockReturnValue(query(null));
    PluginDocument.exists.mockResolvedValue({ _id: objectId('doc1') });

    const res = await patchJson(`/plugin-documents/${DOC_ID}`, {
      body: 'Text from the other device.',
      baseVersion: NOW.toISOString(),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'pluginDocument.stale_write' });
  });

  /* The two failures have to stay distinguishable, because the client does opposite things with
     them: a stale write is still wanted and gets merged and retried, while a write to a document
     that has been deleted is moot and is dropped. */
  it('still says not-found when the row is genuinely gone', async () => {
    PluginDocument.findOneAndUpdate.mockReturnValue(query(null));
    PluginDocument.exists.mockResolvedValue(null);

    const res = await patchJson(`/plugin-documents/${DOC_ID}`, {
      body: 'Text.',
      baseVersion: NOW.toISOString(),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'pluginDocument.not_found' });
  });

  it('does not go looking for the row when no precondition was given', async () => {
    PluginDocument.findOneAndUpdate.mockReturnValue(query(null));

    const res = await patchJson(`/plugin-documents/${DOC_ID}`, { title: 'Renamed' });

    expect(res.status).toBe(404);
    expect(PluginDocument.exists).not.toHaveBeenCalled();
  });

  /* Titles, parents and sibling order stay unconditional on purpose. They are single small fields
     where last-write-wins is what anyone would expect, and a precondition on them would only
     manufacture conflicts between edits that never overlapped. */
  it('leaves the filter alone for a write that names no version', async () => {
    PluginDocument.findOneAndUpdate.mockReturnValue(query(leanDocument({ title: 'Renamed' })));

    await patchJson(`/plugin-documents/${DOC_ID}`, { title: 'Renamed' });

    const [filter] = PluginDocument.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
    expect(filter).toEqual({ _id: DOC_ID, userId: USER_ID });
  });

  it('treats a write with nothing to change as a read rather than an empty $set', async () => {
    // Mongo rejects `$set: {}`, and every field of the update schema is optional.
    PluginDocument.findOne.mockReturnValue(query(leanDocument()));

    const res = await patchJson(`/plugin-documents/${DOC_ID}`, {
      baseVersion: NOW.toISOString(),
    });

    expect(res.status).toBe(200);
    expect(PluginDocument.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses to touch another account’s document', async () => {
    PluginDocument.findOneAndUpdate.mockReturnValue(query(leanDocument()));

    await patchJson(`/plugin-documents/${DOC_ID}`, { body: 'Text.' });

    const [filter] = PluginDocument.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
    expect(filter.userId).toBe(USER_ID);
  });

  it('answers not-found for an id that is not an ObjectId at all', async () => {
    const res = await patchJson('/plugin-documents/not-an-id', { title: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('POST /plugin-documents', () => {
  it('creates a row owned by the caller', async () => {
    PluginDocument.create.mockResolvedValue([doc(leanDocument())]);

    const res = await postJson(app, '/plugin-documents', {
      pluginId: 'notebook',
      title: 'A thought',
      body: 'One sentence. Two sentences.',
      sortKey: 'a0',
    });

    expect(res.status).toBe(201);
    const [docs] = PluginDocument.create.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(docs[0].userId).toBe(USER_ID);
  });

  it('treats a replayed create as the success it already was', async () => {
    PluginDocument.create.mockRejectedValue(duplicateKeyError('_id'));
    PluginDocument.findOne.mockReturnValue(query(leanDocument()));

    const res = await postJson(app, '/plugin-documents', { id: DOC_ID, pluginId: 'notebook' });

    expect(res.status).toBe(200);
  });

  /* Two devices writing the same document on the same day both create that day's revision, and the
     unique index keeps one. The loser drops its phantom row and takes the server's — the day's work
     itself is not at risk, because it lives in the document's own text, which is merged rather than
     overwritten. */
  it('calls a second revision for the same document and day a conflict', async () => {
    PluginDocument.create.mockRejectedValue(duplicateKeyError('dateKey'));

    const res = await postJson(app, '/plugin-documents', {
      pluginId: 'notebook',
      dateKey: '2026-08-18',
      documentId: DOC_ID,
      body: '{"v":2,"ops":[]}',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'pluginDocument.duplicate_revision' });
  });
});
