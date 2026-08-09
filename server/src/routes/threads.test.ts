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

/* Threads. The same create/patch/delete shape as tags, with one difference that is the whole
 * reason it gets its own file rather than a parameterised sweep: deleting a thread only *ungroups*
 * its entries. The entries survive, and so does every `saidTo` mark a "mark all as said" ever
 * wrote — those live on the entries and are the real record of what was actually discussed.
 *
 * A cascade that took the entries with it would be a data-loss bug that no status code reveals.
 */

const Thread = modelDouble();
const Entry = modelDouble();
const deletions = vi.hoisted(() => ({
  record: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
}));

vi.mock('../models/thread', () => ({ Thread }));
vi.mock('../models/entry', () => ({ Entry }));
vi.mock('../models/deletion', () => ({
  recordDeletions: deletions.record,
  clearDeletions: deletions.clear,
}));

const { threadsRouter } = await import('./threads');

const app = routeApp('/threads', threadsRouter);

const THREAD_ID = oid('th1');
const NOW = new Date('2026-08-01T09:00:00.000Z');
const leanThread = (patch: Record<string, unknown> = {}) => ({
  _id: objectId('th1'),
  name: 'Job hunt',
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
});

beforeEach(() => {
  resetModels(Thread, Entry);
  deletions.record.mockClear();
  deletions.clear.mockClear();
});

describe('POST /threads', () => {
  it('creates a thread owned by the caller', async () => {
    Thread.create.mockResolvedValue([doc(leanThread())]);

    const res = await postJson(app, '/threads', { name: 'Job hunt' });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: THREAD_ID,
      name: 'Job hunt',
      // Both timestamps reach the client as ISO strings — ThreadDto carries them because the
      // threads page sorts by them.
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const [docs] = Thread.create.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(docs[0].userId).toBe(USER_ID);
  });

  it('treats a replayed create as the success it already was', async () => {
    Thread.create.mockRejectedValue(duplicateKeyError('_id'));
    Thread.findOne.mockReturnValue(query(leanThread()));

    const res = await postJson(app, '/threads', { id: THREAD_ID, name: 'Job hunt' });

    expect(res.status).toBe(200);
    expect(Thread.findOne).toHaveBeenCalledWith({ _id: THREAD_ID, userId: USER_ID });
  });

  it('calls a duplicate name a conflict', async () => {
    Thread.create.mockRejectedValue(duplicateKeyError('name'));

    const res = await postJson(app, '/threads', { name: 'Job hunt' });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'thread.duplicate_name' });
  });

  it('retracts the tombstone when an id is created again', async () => {
    Thread.create.mockResolvedValue([doc(leanThread())]);

    await postJson(app, '/threads', { id: THREAD_ID, name: 'Job hunt' });

    expect(deletions.clear).toHaveBeenCalledWith(USER_ID, 'thread', [objectId('th1')]);
  });

  it('refuses an empty name', async () => {
    const res = await postJson(app, '/threads', { name: '   ' });

    expect(res.status).toBe(400);
    expect(Thread.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /threads/:id', () => {
  it('renames a thread of the caller’s own', async () => {
    Thread.findOneAndUpdate.mockReturnValue(query(leanThread({ name: 'Flat hunt' })));

    const res = await postJson(app, `/threads/${THREAD_ID}`, { name: 'Flat hunt' }, 'PATCH');

    expect(res.status).toBe(200);
    expect(Thread.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: THREAD_ID, userId: USER_ID },
      { $set: { name: 'Flat hunt' } },
      { returnDocument: 'after', runValidators: true },
    );
  });

  it('answers 404 for someone else’s thread', async () => {
    Thread.findOneAndUpdate.mockReturnValue(query(null));

    const res = await postJson(app, `/threads/${THREAD_ID}`, { name: 'Flat hunt' }, 'PATCH');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'thread.not_found' });
  });

  it('answers 404 for a malformed id without reaching the database', async () => {
    const res = await postJson(app, '/threads/nope', { name: 'Flat hunt' }, 'PATCH');

    expect(res.status).toBe(404);
    expect(Thread.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /threads/:id', () => {
  it('ungroups the entries rather than deleting them, and records a tombstone', async () => {
    Thread.findOneAndDelete.mockReturnValue(query(leanThread()));

    const res = await app.request(`/threads/${THREAD_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    const threadId = objectId('th1');
    /* `$pull` on the membership array, and nothing else. The assertion worth having is as much
       about what is *absent*: no deleteMany on entries anywhere in this route. Losing a month of
       diary because a grouping label was tidied away would be unrecoverable. */
    expect(Entry.updateMany).toHaveBeenCalledWith(
      { userId: USER_ID, threads: threadId },
      { $pull: { threads: threadId } },
    );
    expect(Entry.deleteMany).not.toHaveBeenCalled();
    expect(deletions.record).toHaveBeenCalledWith(USER_ID, 'thread', [threadId]);
  });

  it('answers 404 and touches nothing when there was no such thread', async () => {
    Thread.findOneAndDelete.mockReturnValue(query(null));

    const res = await app.request(`/threads/${THREAD_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(Entry.updateMany).not.toHaveBeenCalled();
    expect(deletions.record).not.toHaveBeenCalled();
  });
});
