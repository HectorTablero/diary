import { DEFAULT_SETTINGS } from '@diary/shared';
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

/* People — the largest router, and the only one whose PATCH is written field by field.
 *
 * That hand-written PATCH is the reason this file is long. Every other update route hands Mongo a
 * `$set` of whatever arrived; this one applies *only the keys the client actually sent*, because a
 * PATCH replayed from an older client knows nothing of the fields added since and a wholesale set
 * would blank them. Thirteen `if (input.x !== undefined)` lines is thirteen chances to get that
 * wrong in a way no response body reveals — the field is simply empty next time you look.
 */

const Person = modelDouble();
const Entry = modelDouble();
const Tag = modelDouble();
const deletions = vi.hoisted(() => ({
  record: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
}));
const settings = vi.hoisted(() => ({ getSettings: vi.fn() }));

vi.mock('../models/person', () => ({ Person }));
vi.mock('../models/entry', () => ({ Entry }));
vi.mock('../models/tag', () => ({ Tag }));
vi.mock('../models/deletion', () => ({
  recordDeletions: deletions.record,
  clearDeletions: deletions.clear,
}));
vi.mock('../services/settingsService', () => settings);

const { peopleRouter } = await import('./people');

const app = routeApp('/people', peopleRouter);

const PERSON_ID = oid('p1');
const NOW = new Date('2026-08-01T09:00:00.000Z');

const leanPerson = (patch: Record<string, unknown> = {}) => ({
  _id: objectId('p1'),
  name: 'Ana',
  aliases: ['Mum'],
  phone: null,
  email: null,
  wechatId: null,
  birthday: null,
  company: null,
  jobTitle: 'Nurse',
  contactId: null,
  events: [],
  tags: [],
  notes: 'Likes gardening',
  checkupIntervalDays: 30,
  lastCheckupAt: NOW,
  createdAt: NOW,
  ...patch,
});

beforeEach(() => {
  resetModels(Person, Entry, Tag);
  deletions.record.mockClear();
  deletions.clear.mockClear();
  settings.getSettings.mockReset();
  settings.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
});

describe('POST /people', () => {
  it('creates a person owned by the caller and answers 201', async () => {
    Person.create.mockResolvedValue([doc(leanPerson())]);

    const res = await postJson(app, '/people', { name: 'Ana' });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: PERSON_ID, name: 'Ana' });
    const [docs] = Person.create.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(docs[0].userId).toBe(USER_ID);
  });

  it('inherits the account’s default checkup interval when the client names none', async () => {
    settings.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, defaultCheckupIntervalDays: 30 });
    Person.create.mockResolvedValue([doc(leanPerson())]);

    await postJson(app, '/people', { name: 'Ana' });

    const [docs] = Person.create.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(docs[0].checkupIntervalDays).toBe(30);
  });

  it('lets an explicit null turn checkups off, rather than falling back to the default', async () => {
    settings.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, defaultCheckupIntervalDays: 30 });
    Person.create.mockResolvedValue([doc(leanPerson({ checkupIntervalDays: null }))]);

    await postJson(app, '/people', { name: 'Ana', checkupIntervalDays: null });

    /* `null` is a real value here and `undefined` means "not specified" — a `??` on this field
       would silently re-enable checkups for someone who deliberately turned them off. */
    const [docs] = Person.create.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(docs[0].checkupIntervalDays).toBeNull();
  });

  it('starts lastCheckupAt at the person’s own createdAt, not at the server’s clock', async () => {
    Person.create.mockResolvedValue([doc(leanPerson())]);
    const createdAt = '2026-01-02T03:04:05.000Z';

    await postJson(app, '/people', { name: 'Ana', createdAt });

    /* A contact imported with its real creation date must not read as "spoke to them just now" —
       that would suppress the first checkup for a full interval. */
    const [docs] = Person.create.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(docs[0].lastCheckupAt).toEqual(new Date(createdAt));
    expect(docs[0].createdAt).toEqual(new Date(createdAt));
  });

  it('keeps only the tags the caller owns', async () => {
    Tag.find.mockReturnValue(query([{ _id: objectId('t1') }]));
    Person.create.mockResolvedValue([doc(leanPerson())]);

    await postJson(app, '/people', { name: 'Ana', tags: [oid('t1'), oid('t2')] });

    // Same rule as settings' broadcast tags: ids arriving from a client are re-read scoped to the
    // user, so one belonging to somebody else cannot be attached.
    expect(Tag.find).toHaveBeenCalledWith(
      { userId: USER_ID, _id: { $in: [objectId('t1'), objectId('t2')] } },
      '_id',
    );
    const [docs] = Person.create.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(docs[0].tags).toEqual([objectId('t1')]);
  });

  it('treats a replayed create as the success it already was', async () => {
    Person.create.mockRejectedValue(duplicateKeyError('_id'));
    Person.findOne.mockReturnValue(query(leanPerson()));

    const res = await postJson(app, '/people', { id: PERSON_ID, name: 'Ana' });

    expect(res.status).toBe(200);
    expect(Person.findOne).toHaveBeenCalledWith({ _id: PERSON_ID, userId: USER_ID });
  });

  it('calls a duplicate name a conflict', async () => {
    Person.create.mockRejectedValue(duplicateKeyError('name'));

    const res = await postJson(app, '/people', { name: 'Ana' });

    // Names must stay unique per user: `@Ana` in an entry has to resolve to exactly one person.
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'person.duplicate_name' });
  });

  it('retracts the tombstone when an id is created again', async () => {
    Person.create.mockResolvedValue([doc(leanPerson())]);

    await postJson(app, '/people', { id: PERSON_ID, name: 'Ana' });

    expect(deletions.clear).toHaveBeenCalledWith(USER_ID, 'person', [objectId('p1')]);
  });

  it('refuses a person with no name', async () => {
    const res = await postJson(app, '/people', { name: '' });

    expect(res.status).toBe(400);
    expect(Person.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /people/:id', () => {
  it('applies only the fields the client sent', async () => {
    const person = doc(leanPerson());
    Person.findOne.mockReturnValue(query(person));

    const res = await postJson(app, `/people/${PERSON_ID}`, { name: 'Ana María' }, 'PATCH');

    expect(res.status).toBe(200);
    expect(person.name).toBe('Ana María');
    /* Everything else untouched. This is the assertion the whole hand-written PATCH exists for: a
       payload from an older client, or from a form that only edits the name, must not blank the
       notes, the aliases or the job title. */
    expect(person.notes).toBe('Likes gardening');
    expect(person.aliases).toEqual(['Mum']);
    expect(person.jobTitle).toBe('Nurse');
    expect(person.checkupIntervalDays).toBe(30);
  });

  it('lets an explicitly null field be cleared', async () => {
    const person = doc(leanPerson({ jobTitle: 'Nurse' }));
    Person.findOne.mockReturnValue(query(person));

    await postJson(app, `/people/${PERSON_ID}`, { jobTitle: null }, 'PATCH');

    // `null` is sent, so it applies — the guard is on `undefined`, which is what absence means.
    expect(person.jobTitle).toBeNull();
  });

  it('re-scopes tags on update too', async () => {
    const person = doc(leanPerson());
    Person.findOne.mockReturnValue(query(person));
    Tag.find.mockReturnValue(query([{ _id: objectId('t1') }]));

    await postJson(app, `/people/${PERSON_ID}`, { tags: [oid('t1'), oid('t2')] }, 'PATCH');

    expect(person.tags).toEqual([objectId('t1')]);
  });

  it('reads the person scoped to the caller', async () => {
    Person.findOne.mockReturnValue(query(doc(leanPerson())));

    await postJson(app, `/people/${PERSON_ID}`, { name: 'Ana María' }, 'PATCH');

    expect(Person.findOne).toHaveBeenCalledWith({ _id: PERSON_ID, userId: USER_ID });
  });

  it('answers 404 for someone else’s person', async () => {
    Person.findOne.mockReturnValue(query(null));

    const res = await postJson(app, `/people/${PERSON_ID}`, { name: 'Ana' }, 'PATCH');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'person.not_found' });
  });

  it('answers 404 for a malformed id without reaching the database', async () => {
    const res = await postJson(app, '/people/nope', { name: 'Ana' }, 'PATCH');

    expect(res.status).toBe(404);
    expect(Person.findOne).not.toHaveBeenCalled();
  });

  it('maps a rename collision to 409', async () => {
    const person = doc(leanPerson());
    person.save.mockRejectedValue(duplicateKeyError('name'));
    Person.findOne.mockReturnValue(query(person));

    const res = await postJson(app, `/people/${PERSON_ID}`, { name: 'Ben' }, 'PATCH');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'person.duplicate_name' });
  });
});

describe('DELETE /people/:id', () => {
  it('detaches the person from every entry that references them, and records a tombstone', async () => {
    Person.findOneAndDelete.mockReturnValue(query(leanPerson()));

    const res = await app.request(`/people/${PERSON_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(Person.findOneAndDelete).toHaveBeenCalledWith({ _id: PERSON_ID, userId: USER_ID });

    const personId = objectId('p1');
    /* All three places a person id can appear on an entry — mentioned, said-to, hidden-for — and
       the filter names all three too. Scoped, because sync pulls are driven by `updatedAt`: an
       unscoped updateMany would re-send the user's entire diary to every device. */
    expect(Entry.updateMany).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        $or: [{ people: personId }, { 'saidTo.person': personId }, { hiddenFor: personId }],
      },
      { $pull: { people: personId, saidTo: { person: personId }, hiddenFor: personId } },
    );
    expect(deletions.record).toHaveBeenCalledWith(USER_ID, 'person', [personId]);
  });

  it('answers 404 and cascades nothing when there was no such person', async () => {
    Person.findOneAndDelete.mockReturnValue(query(null));

    const res = await app.request(`/people/${PERSON_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(Entry.updateMany).not.toHaveBeenCalled();
    expect(deletions.record).not.toHaveBeenCalled();
  });
});

describe('PUT /people/:id/checkup', () => {
  it('stamps the contact as happening now', async () => {
    Person.findOneAndUpdate.mockReturnValue(query(leanPerson()));

    const res = await app.request(`/people/${PERSON_ID}/checkup`, { method: 'PUT' });

    expect(res.status).toBe(200);
    const [filter, update] = Person.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { lastCheckupAt: Date },
    ];
    expect(filter).toEqual({ _id: PERSON_ID, userId: USER_ID });
    expect(update.lastCheckupAt).toBeInstanceOf(Date);
  });

  it('answers 404 for someone else’s person', async () => {
    Person.findOneAndUpdate.mockReturnValue(query(null));

    const res = await app.request(`/people/${PERSON_ID}/checkup`, { method: 'PUT' });

    expect(res.status).toBe(404);
  });
});

describe('PUT /people/:id/events/:eventId/asked', () => {
  it('marks the event asked and counts it as an interaction', async () => {
    Person.findOneAndUpdate.mockReturnValue(query(leanPerson()));

    const res = await app.request(`/people/${PERSON_ID}/events/evt_1/asked`, { method: 'PUT' });

    expect(res.status).toBe(200);
    const [filter, update] = Person.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    /* The filter requires the event as well as the person, which is what makes a wrong event id a
       404 rather than a silent no-op on a real person. */
    expect(filter).toMatchObject({ _id: PERSON_ID, userId: USER_ID, 'events.id': 'evt_1' });
    /* Both stamps, and the same instant for each. Asking someone how their trip went *is* talking
       to them, so it has to move the checkup clock — the client applies the identical rule locally
       (mutations.markEventAsked), and the two only converge if the server does this too. */
    expect(update.$set['events.$.askedAt']).toEqual(update.$set.lastCheckupAt);
  });

  it('answers 404 when the person has no such event', async () => {
    Person.findOneAndUpdate.mockReturnValue(query(null));

    const res = await app.request(`/people/${PERSON_ID}/events/nope/asked`, { method: 'PUT' });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'person.not_found' });
  });
});
