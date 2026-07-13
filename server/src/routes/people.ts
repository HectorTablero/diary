import type { PersonListItem } from '@diary/shared';
import { OBJECT_ID_REGEX, pageQuerySchema, personCreateSchema, personUpdateSchema } from '@diary/shared';
import { Hono } from 'hono';
import { Types } from 'mongoose';
import { conflict, notFound } from '../errors';
import type { AppEnv } from '../middleware/session';
import { jsonValidator, queryValidator } from '../middleware/validate';
import { recordDeletions } from '../models/deletion';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { personToDto, type LeanPerson } from '../dto';
import { Tag } from '../models/tag';
import {
  countTalkingPoints,
  getHistory,
  getMemories,
  getSettings,
  getTalkingPoints,
} from '../services/talkingPointsService';

const oid = (value: string) => {
  if (!OBJECT_ID_REGEX.test(value)) throw notFound('person.not_found');
  return value;
};

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

async function ownedTagIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const tags = await Tag.find({ userId, _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }, '_id').lean();
  return tags.map((t) => t._id);
}

const PERSON_POPULATE = { path: 'tags', select: 'name color' };

export const peopleRouter = new Hono<AppEnv>()
  .get('/', async (c) => {
    const userId = c.get('userId');
    const [people, counts] = await Promise.all([
      Person.find({ userId }).sort({ name: 1 }).populate(PERSON_POPULATE).lean(),
      countTalkingPoints(userId),
    ]);
    const result: PersonListItem[] = (people as unknown as LeanPerson[]).map((p) => ({
      ...personToDto(p),
      talkingPointCount: counts.get(p._id.toString()) ?? 0,
    }));
    return c.json({ people: result });
  })
  .post('/', jsonValidator(personCreateSchema), async (c) => {
    const userId = c.get('userId');
    const input = c.req.valid('json');
    try {
      const checkupIntervalDays =
        input.checkupIntervalDays !== undefined
          ? input.checkupIntervalDays
          : (await getSettings(userId)).defaultCheckupIntervalDays;
      const createdAt = input.createdAt ? new Date(input.createdAt) : new Date();
      // timestamps off: keep updatedAt at server time (not createdAt) so replayed offline
      // creates still hit other clients' sync cursors.
      const [person] = await Person.create(
        [
          {
            _id: input.id ? new Types.ObjectId(input.id) : new Types.ObjectId(),
            createdAt,
            updatedAt: new Date(),
            userId,
            name: input.name,
            aliases: input.aliases,
            phone: input.phone,
            email: input.email,
            wechatId: input.wechatId,
            birthday: input.birthday,
            company: input.company,
            jobTitle: input.jobTitle,
            contactId: input.contactId,
            events: input.events,
            tags: await ownedTagIds(userId, input.tags),
            notes: input.notes,
            checkupIntervalDays,
            lastCheckupAt: createdAt,
          },
        ],
        { timestamps: false },
      );
      const populated = await person.populate(PERSON_POPULATE);
      return c.json(personToDto(populated.toObject() as unknown as LeanPerson), 201);
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('person.duplicate_name');
      throw err;
    }
  })
  .get('/:id', async (c) => {
    const person = await Person.findOne({ _id: oid(c.req.param('id')), userId: c.get('userId') })
      .populate(PERSON_POPULATE)
      .lean();
    if (!person) throw notFound('person.not_found');
    return c.json(personToDto(person as unknown as LeanPerson));
  })
  .patch('/:id', jsonValidator(personUpdateSchema), async (c) => {
    const userId = c.get('userId');
    const person = await Person.findOne({ _id: oid(c.req.param('id')), userId });
    if (!person) throw notFound('person.not_found');
    const input = c.req.valid('json');
    // Only keys the client actually sent are applied, so a PATCH replayed from an older client
    // (which knows nothing of these fields) can't blank them.
    if (input.name !== undefined) person.name = input.name;
    if (input.aliases !== undefined) person.aliases = input.aliases;
    if (input.phone !== undefined) person.phone = input.phone;
    if (input.email !== undefined) person.email = input.email;
    if (input.wechatId !== undefined) person.wechatId = input.wechatId;
    if (input.birthday !== undefined) person.birthday = input.birthday;
    if (input.company !== undefined) person.company = input.company;
    if (input.jobTitle !== undefined) person.jobTitle = input.jobTitle;
    if (input.contactId !== undefined) person.contactId = input.contactId;
    // Mongoose casts the ISO strings in askedAt/createdAt to Dates on save.
    if (input.events !== undefined) person.set('events', input.events);
    if (input.notes !== undefined) person.notes = input.notes;
    if (input.tags !== undefined) person.tags = await ownedTagIds(userId, input.tags);
    if (input.checkupIntervalDays !== undefined) person.checkupIntervalDays = input.checkupIntervalDays;
    try {
      await person.save();
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('person.duplicate_name');
      throw err;
    }
    const populated = await person.populate(PERSON_POPULATE);
    return c.json(personToDto(populated.toObject() as unknown as LeanPerson));
  })
  .delete('/:id', async (c) => {
    const userId = c.get('userId');
    const id = oid(c.req.param('id'));
    const person = await Person.findOneAndDelete({ _id: id, userId }).lean();
    if (!person) throw notFound('person.not_found');
    const personId = new Types.ObjectId(id);
    // Scoped filter: only entries that actually reference the person get their updatedAt bumped
    // (sync pulls rely on updatedAt, so an unscoped updateMany would re-send every entry).
    await Entry.updateMany(
      { userId, $or: [{ people: personId }, { 'saidTo.person': personId }, { hiddenFor: personId }] },
      { $pull: { people: personId, saidTo: { person: personId }, hiddenFor: personId } },
    );
    await recordDeletions(userId, 'person', [personId]);
    return c.json({ ok: true });
  })
  .put('/:id/checkup', async (c) => {
    const userId = c.get('userId');
    const person = await Person.findOneAndUpdate(
      { _id: oid(c.req.param('id')), userId },
      { lastCheckupAt: new Date() },
      { new: true },
    )
      .populate(PERSON_POPULATE)
      .lean();
    if (!person) throw notFound('person.not_found');
    return c.json(personToDto(person as unknown as LeanPerson));
  })
  /* Its own route rather than a plain PATCH of the events array, because asking someone how their
     trip went *is* an interaction: it has to bump lastCheckupAt too. The client applies the same
     rule locally (mutations.markEventAsked), so the two converge — same contract as /checkup. */
  .put('/:id/events/:eventId/asked', async (c) => {
    const userId = c.get('userId');
    const now = new Date();
    const person = await Person.findOneAndUpdate(
      { _id: oid(c.req.param('id')), userId, 'events.id': c.req.param('eventId') },
      { $set: { 'events.$.askedAt': now, lastCheckupAt: now } },
      { new: true },
    )
      .populate(PERSON_POPULATE)
      .lean();
    // Also covers "the person exists but has no such event" — the filter above requires both.
    if (!person) throw notFound('person.not_found');
    return c.json(personToDto(person as unknown as LeanPerson));
  })
  .get('/:id/talking-points', async (c) => {
    return c.json(await getTalkingPoints(c.get('userId'), oid(c.req.param('id'))));
  })
  .get('/:id/memories', async (c) => {
    return c.json({ memories: await getMemories(c.get('userId'), oid(c.req.param('id'))) });
  })
  .get('/:id/history', queryValidator(pageQuerySchema), async (c) => {
    const { page, limit } = c.req.valid('query');
    return c.json(await getHistory(c.get('userId'), oid(c.req.param('id')), page, limit));
  });
