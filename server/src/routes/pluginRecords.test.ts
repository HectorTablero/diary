import { MAX_PLUGIN_DATA_BYTES } from '@diary/shared';
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

/* The one collection whose contents the server does not understand.
 *
 * Every other route validates a known shape; this one accepts an opaque `data` blob so that adding
 * a plugin stays a client-only change. What that trades away is the schema, and what stands in for
 * it is the set of bounds asserted here plus the caps in models/pluginRecord. So the tests worth
 * writing are the refusals — and the two structural rules that make the collection safe to share:
 * a row cannot change which plugin owns it, and there is at most one config row per plugin.
 */

const PluginRecord = modelDouble();
const caps = vi.hoisted(() => ({ exceeded: vi.fn(async () => null as string | null) }));
const deletions = vi.hoisted(() => ({
  record: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
}));

vi.mock('../models/pluginRecord', () => ({
  PluginRecord,
  pluginCapExceeded: caps.exceeded,
}));
vi.mock('../models/deletion', () => ({
  recordDeletions: deletions.record,
  clearDeletions: deletions.clear,
}));

const { pluginRecordsRouter } = await import('./pluginRecords');

const app = routeApp('/plugin-records', pluginRecordsRouter);

const RECORD_ID = oid('pr1');
const NOW = new Date('2026-08-01T09:00:00.000Z');
const leanRecord = (patch: Record<string, unknown> = {}) => ({
  _id: objectId('pr1'),
  pluginId: 'habits',
  scope: 'record',
  dateKey: '2026-08-01',
  data: { water: true },
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
});

beforeEach(() => {
  resetModels(PluginRecord);
  caps.exceeded.mockClear().mockResolvedValue(null);
  deletions.record.mockClear();
  deletions.clear.mockClear();
});

describe('POST /plugin-records', () => {
  it('creates a row owned by the caller and hands the data back untouched', async () => {
    PluginRecord.create.mockResolvedValue([doc(leanRecord())]);

    const res = await postJson(app, '/plugin-records', {
      pluginId: 'habits',
      dateKey: '2026-08-01',
      data: { water: true },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: RECORD_ID,
      pluginId: 'habits',
      scope: 'record',
      dateKey: '2026-08-01',
      // Passed through verbatim: the server has no opinion about what a plugin stores.
      data: { water: true },
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const [docs] = PluginRecord.create.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(docs[0].userId).toBe(USER_ID);
  });

  it('defaults an undated row to the empty-string sentinel, never null', async () => {
    PluginRecord.create.mockResolvedValue([doc(leanRecord({ dateKey: '' }))]);

    await postJson(app, '/plugin-records', { pluginId: 'habits', data: {} });

    const [docs] = PluginRecord.create.mock.calls[0] as unknown as [Record<string, unknown>[]];
    // A null would drop the row out of the client's [pluginId+dateKey] index — silently, since
    // IndexedDB cannot index null and a compound index needs every keypath to hold a valid key.
    expect(docs[0].dateKey).toBe('');
  });

  it('treats a replayed create as the success it already was', async () => {
    PluginRecord.create.mockRejectedValue(duplicateKeyError('_id'));
    PluginRecord.findOne.mockReturnValue(query(leanRecord()));

    const res = await postJson(app, '/plugin-records', {
      id: RECORD_ID,
      pluginId: 'habits',
      data: {},
    });

    expect(res.status).toBe(200);
    expect(PluginRecord.findOne).toHaveBeenCalledWith({ _id: RECORD_ID, userId: USER_ID });
  });

  it('calls a second config row for the same plugin a conflict', async () => {
    // Two devices enabling the same plugin while both offline. Converging on the server's row is
    // the same rule every other 409-on-create follows.
    PluginRecord.create.mockRejectedValue(duplicateKeyError('scope'));

    const res = await postJson(app, '/plugin-records', {
      pluginId: 'habits',
      scope: 'config',
      data: { enabled: true },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'pluginRecord.duplicate_config' });
  });

  it('retracts the tombstone when an id is created again', async () => {
    PluginRecord.create.mockResolvedValue([doc(leanRecord())]);

    await postJson(app, '/plugin-records', { id: RECORD_ID, pluginId: 'habits', data: {} });

    expect(deletions.clear).toHaveBeenCalledWith(USER_ID, 'pluginRecord', [objectId('pr1')]);
  });

  describe('refusals', () => {
    it('rejects an oversized data blob before it reaches the database', async () => {
      const res = await postJson(app, '/plugin-records', {
        pluginId: 'habits',
        data: { note: 'x'.repeat(MAX_PLUGIN_DATA_BYTES) },
      });

      expect(res.status).toBe(400);
      expect(PluginRecord.create).not.toHaveBeenCalled();
    });

    it('rejects a malformed plugin id', async () => {
      const res = await postJson(app, '/plugin-records', { pluginId: 'Habits!', data: {} });

      expect(res.status).toBe(400);
      expect(PluginRecord.create).not.toHaveBeenCalled();
    });

    it.each([
      ['records', 'pluginRecord.too_many_records'],
      ['plugins', 'pluginRecord.too_many_plugins'],
    ])('refuses a create that would pass the %s cap', async (kind, code) => {
      caps.exceeded.mockResolvedValue(kind);

      const res = await postJson(app, '/plugin-records', { pluginId: 'habits', data: {} });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: code });
      expect(PluginRecord.create).not.toHaveBeenCalled();
    });
  });
});

describe('PATCH /plugin-records/:id', () => {
  it('replaces data wholesale via $set', async () => {
    PluginRecord.findOneAndUpdate.mockReturnValue(query(leanRecord({ data: { water: false } })));

    const res = await postJson(
      app,
      `/plugin-records/${RECORD_ID}`,
      { data: { water: false } },
      'PATCH',
    );

    expect(res.status).toBe(200);
    /* $set with a whole replacement object, not a mutation of a hydrated doc: Mongoose's Mixed
       type has no change tracking, so an in-place edit saves nothing at all and still answers 200. */
    expect(PluginRecord.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: RECORD_ID, userId: USER_ID },
      { $set: { data: { water: false } } },
      { returnDocument: 'after', runValidators: true },
    );
  });

  it('ignores an attempt to re-scope or re-own the row', async () => {
    PluginRecord.findOneAndUpdate.mockReturnValue(query(leanRecord()));

    await postJson(
      app,
      `/plugin-records/${RECORD_ID}`,
      { pluginId: 'mood', scope: 'config', data: { water: true } },
      'PATCH',
    );

    /* pluginId and scope are identity, not contents. A row that could change owner would let one
       plugin's write land in another plugin's query — and the strip is silent by design, because
       the update schema is a Zod object and unknown keys never reach the $set. */
    const [, update] = PluginRecord.findOneAndUpdate.mock.calls[0] as unknown as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set).toEqual({ data: { water: true } });
  });

  it('answers 404 for someone else’s row', async () => {
    PluginRecord.findOneAndUpdate.mockReturnValue(query(null));

    const res = await postJson(app, `/plugin-records/${RECORD_ID}`, { data: {} }, 'PATCH');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'pluginRecord.not_found' });
  });

  it('answers 404 for a malformed id without reaching the database', async () => {
    const res = await postJson(app, '/plugin-records/nope', { data: {} }, 'PATCH');

    expect(res.status).toBe(404);
    expect(PluginRecord.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /plugin-records/:id', () => {
  it('records a tombstone so other devices learn about the delete', async () => {
    PluginRecord.findOneAndDelete.mockReturnValue(query(leanRecord()));

    const res = await app.request(`/plugin-records/${RECORD_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(deletions.record).toHaveBeenCalledWith(USER_ID, 'pluginRecord', [objectId('pr1')]);
  });

  it('answers 404 and records nothing when there was no such row', async () => {
    PluginRecord.findOneAndDelete.mockReturnValue(query(null));

    const res = await app.request(`/plugin-records/${RECORD_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(deletions.record).not.toHaveBeenCalled();
  });
});
