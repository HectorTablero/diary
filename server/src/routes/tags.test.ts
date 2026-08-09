import { DEFAULT_TAG_COLORS } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  doc,
  duplicateKeyError,
  failingQuery,
  modelDouble,
  objectId,
  oid,
  query,
  resetModels,
} from '../test/mongooseDouble';
import { postJson, routeApp, USER_ID } from '../test/routeApp';

/* The tags router, which is the simplest of the CRUD routes and therefore the one that shows the
 * shape all of them share: a client-supplied id, a replayed create that must not be a conflict, a
 * cascade on delete, and a tombstone at each end of it.
 *
 * Everything is scoped by `userId` from the session, and that is the single most important thing
 * asserted in this file. There is no other authorisation model here — a filter that forgot it would
 * let any signed-in user rename or delete anyone's tag, and no response body would look wrong.
 */

const Tag = modelDouble();
const Entry = modelDouble();
const Person = modelDouble();
const deletions = vi.hoisted(() => ({
  record: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
}));

vi.mock('../models/tag', () => ({ Tag }));
vi.mock('../models/entry', () => ({ Entry }));
vi.mock('../models/person', () => ({ Person }));
vi.mock('../models/deletion', () => ({
  recordDeletions: deletions.record,
  clearDeletions: deletions.clear,
}));

const { tagsRouter } = await import('./tags');

const app = routeApp('/tags', tagsRouter);

const TAG_ID = oid('t1');
const leanTag = (patch: Record<string, unknown> = {}) => ({
  _id: objectId('t1'),
  name: 'work',
  color: '#4ECDC4',
  ...patch,
});

beforeEach(() => {
  resetModels(Tag, Entry, Person);
  deletions.record.mockClear();
  deletions.clear.mockClear();
});

describe('POST /tags', () => {
  it('creates a tag owned by the caller and answers 201 with its DTO', async () => {
    Tag.create.mockResolvedValue([doc(leanTag())]);

    const res = await postJson(app, '/tags', { name: 'work', color: '#4ECDC4' });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: TAG_ID, name: 'work', color: '#4ECDC4' });
    const [[created]] = Tag.create.mock.calls as unknown as [[Record<string, unknown>[]]];
    expect(created[0].userId).toBe(USER_ID);
  });

  it('writes with timestamps off, so a replayed offline create still moves the sync cursor', async () => {
    Tag.create.mockResolvedValue([doc(leanTag())]);
    const createdAt = '2026-01-02T03:04:05.000Z';

    await postJson(app, '/tags', { name: 'work', id: TAG_ID, createdAt });

    /* `createdAt` is honoured (it is the client's record of when this happened) while `updatedAt`
       is stamped *now* — which is the point of `{ timestamps: false }`. Were updatedAt allowed to
       follow createdAt, a create replayed after a week offline would land behind every other
       device's sync cursor and simply never be pulled. */
    const [docs, options] = Tag.create.mock.calls[0] as unknown as [
      Record<string, unknown>[],
      { timestamps: boolean },
    ];
    expect(options).toEqual({ timestamps: false });
    expect(docs[0].createdAt).toEqual(new Date(createdAt));
    expect((docs[0].updatedAt as Date).getTime()).toBeGreaterThan(Date.parse(createdAt));
  });

  it('picks the first unused palette colour when the client names none', async () => {
    // The first two are taken, so the third is the one that must be chosen.
    Tag.find.mockReturnValue(
      query([{ color: DEFAULT_TAG_COLORS[0] }, { color: DEFAULT_TAG_COLORS[1] }]),
    );
    Tag.create.mockResolvedValue([doc(leanTag({ color: DEFAULT_TAG_COLORS[2] }))]);

    await postJson(app, '/tags', { name: 'work' });

    const [[docs]] = Tag.create.mock.calls as unknown as [[Record<string, unknown>[]]];
    expect(docs[0].color).toBe(DEFAULT_TAG_COLORS[2]);
    // Only this user's palette is consulted — colours are per-user, not global.
    expect(Tag.find).toHaveBeenCalledWith({ userId: USER_ID }, 'color');
  });

  /* The single subtlest decision in every create route, and the one with the worst failure mode.
     The outbox only drops an op once its response arrives, so a create whose response was lost gets
     sent again — and the client reads a 409 on POST as "my local copy is a phantom" and deletes the
     row. Answering a replay as a conflict therefore destroys the entry it was trying to save. */
  it('treats a replayed create as the success it already was', async () => {
    Tag.create.mockRejectedValue(duplicateKeyError('_id'));
    Tag.findOne.mockReturnValue(query(leanTag()));

    const res = await postJson(app, '/tags', { id: TAG_ID, name: 'work' });

    // 200, not 409 and not 201: the document is there, which is what the caller wanted.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: TAG_ID });
    expect(Tag.findOne).toHaveBeenCalledWith({ _id: TAG_ID, userId: USER_ID });
  });

  it('still calls a duplicate name a conflict, even on a create carrying an id', async () => {
    Tag.create.mockRejectedValue(duplicateKeyError('name'));

    const res = await postJson(app, '/tags', { id: TAG_ID, name: 'work' });

    /* A name collision is a real conflict the user has to resolve. Mistaking it for a replay would
       hand back a *different* tag as though the create had worked. */
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'tag.duplicate_name' });
  });

  it('does not go looking for a replay when the client supplied no id', async () => {
    Tag.create.mockRejectedValue(duplicateKeyError('_id'));

    const res = await postJson(app, '/tags', { name: 'work' });

    // Without a client id there is nothing to have replayed — the server minted the id itself.
    expect(Tag.findOne).not.toHaveBeenCalled();
    expect(res.status).toBe(409);
  });

  it('retracts the tombstone when an id is created again, which is what undo does', async () => {
    Tag.create.mockResolvedValue([doc(leanTag())]);

    await postJson(app, '/tags', { id: TAG_ID, name: 'work' });

    /* Leaving the tombstone would make the server hold two contradictory facts about one id — the
       tag exists *and* was deleted — and which one a device ends up with depends on where its
       cursor happens to sit. That is how undo used to un-work itself a few seconds later. */
    expect(deletions.clear).toHaveBeenCalledWith(USER_ID, 'tag', [objectId('t1')]);
  });

  it('does not retract anything for a freshly minted id', async () => {
    Tag.create.mockResolvedValue([doc(leanTag())]);

    await postJson(app, '/tags', { name: 'work' });

    expect(deletions.clear).not.toHaveBeenCalled();
  });

  it('refuses a payload the schema rejects, before touching the database', async () => {
    const res = await postJson(app, '/tags', { name: '' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'errors.validation' });
    expect(Tag.create).not.toHaveBeenCalled();
  });

  it('refuses a colour that is not #RRGGBB', async () => {
    const res = await postJson(app, '/tags', { name: 'work', color: 'red' });

    expect(res.status).toBe(400);
    expect(Tag.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /tags/:id', () => {
  it('renames a tag of the caller’s own', async () => {
    Tag.findOneAndUpdate.mockReturnValue(query(leanTag({ name: 'projects' })));

    const res = await postJson(app, `/tags/${TAG_ID}`, { name: 'projects' }, 'PATCH');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'projects' });
    expect(Tag.findOneAndUpdate).toHaveBeenCalledWith(
      // The security assertion: the id from the path is always paired with the session's user.
      { _id: TAG_ID, userId: USER_ID },
      { $set: { name: 'projects' } },
      { returnDocument: 'after', runValidators: true },
    );
  });

  it('answers 404 for an id belonging to somebody else', async () => {
    // Indistinguishable from "no such tag", and that is the point — a 403 would confirm the id
    // exists, which is more than a stranger should be able to learn.
    Tag.findOneAndUpdate.mockReturnValue(query(null));

    const res = await postJson(app, `/tags/${TAG_ID}`, { name: 'projects' }, 'PATCH');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'tag.not_found' });
  });

  it('answers 404 for an id that is not an ObjectId at all', async () => {
    const res = await postJson(app, '/tags/not-an-id', { name: 'projects' }, 'PATCH');

    /* The `oid()` guard. Without it the string reaches Mongoose, which throws a CastError — a 500
       and a telemetry incident for what is only ever a stale link or a typo. */
    expect(res.status).toBe(404);
    expect(Tag.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('maps a duplicate name to 409', async () => {
    Tag.findOneAndUpdate.mockReturnValue(failingQuery(duplicateKeyError('name')));

    const res = await postJson(app, `/tags/${TAG_ID}`, { name: 'work' }, 'PATCH');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'tag.duplicate_name' });
  });
});

describe('DELETE /tags/:id', () => {
  it('deletes the tag, detaches it everywhere, and records a tombstone', async () => {
    Tag.findOneAndDelete.mockReturnValue(query(leanTag()));

    const res = await app.request(`/tags/${TAG_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(Tag.findOneAndDelete).toHaveBeenCalledWith({ _id: TAG_ID, userId: USER_ID });

    /* Both cascades are *scoped to documents that actually carry the tag*. An unscoped updateMany
       would bump `updatedAt` on the user's whole diary, and since sync pulls are driven by
       updatedAt that would re-send every entry they own to every device on the next pull. */
    const tagId = objectId('t1');
    expect(Entry.updateMany).toHaveBeenCalledWith(
      { userId: USER_ID, tags: tagId },
      { $pull: { tags: tagId } },
    );
    expect(Person.updateMany).toHaveBeenCalledWith(
      { userId: USER_ID, tags: tagId },
      { $pull: { tags: tagId } },
    );
    // Without this the other devices would keep the tag forever — a delete they never hear about.
    expect(deletions.record).toHaveBeenCalledWith(USER_ID, 'tag', [tagId]);
  });

  it('answers 404 and cascades nothing when there was no such tag', async () => {
    Tag.findOneAndDelete.mockReturnValue(query(null));

    const res = await app.request(`/tags/${TAG_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(404);
    // A tombstone for a document that was never deleted would tell every other device to remove a
    // tag that is still perfectly alive on them.
    expect(deletions.record).not.toHaveBeenCalled();
    expect(Entry.updateMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a malformed id without reaching the database', async () => {
    const res = await app.request('/tags/nope', { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(Tag.findOneAndDelete).not.toHaveBeenCalled();
  });
});
