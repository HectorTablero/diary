import type { EntryCreateInput, EntryUpdateInput } from '@diary/shared';
import { MAX_SUB_ENTRY_DEPTH } from '@diary/shared';
import { Types } from 'mongoose';
import { badRequest, notFound } from '../errors';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { Tag } from '../models/tag';
import { buildEntryTree, ENTRY_POPULATE, entryToDto, type LeanEntry } from '../dto';

const toObjectIds = (ids: string[]) => ids.map((id) => new Types.ObjectId(id));

/** Keep only ids that actually belong to this user. */
async function ownedTagIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const tags = await Tag.find({ userId, _id: { $in: toObjectIds(ids) } }, '_id').lean();
  return tags.map((t) => t._id);
}

async function ownedPersonIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const people = await Person.find({ userId, _id: { $in: toObjectIds(ids) } }, '_id').lean();
  return people.map((p) => p._id);
}

async function assertDepthAllowed(userId: string, parentId: string) {
  let depth = 1; // the new entry's depth if the parent is a root
  let current = await Entry.findOne({ _id: parentId, userId }, 'parentId').lean();
  if (!current) throw notFound('entry.not_found');
  while (current.parentId) {
    depth += 1;
    if (depth > MAX_SUB_ENTRY_DEPTH) throw badRequest('entry.max_depth');
    current = await Entry.findOne({ _id: current.parentId, userId }, 'parentId').lean();
    if (!current) break;
  }
  if (depth > MAX_SUB_ENTRY_DEPTH) throw badRequest('entry.max_depth');
}

export async function getDayEntries(userId: string, dateKey: string) {
  const entries = await Entry.find({ userId, dateKey }).populate(ENTRY_POPULATE).lean();
  return buildEntryTree(entries as unknown as LeanEntry[]);
}

/** Bump the checkup clock: marking something as said counts as a real interaction. */
async function bumpLastCheckup(userId: string, personIds: Types.ObjectId[], at: Date) {
  if (!personIds.length) return;
  await Person.updateMany({ userId, _id: { $in: personIds } }, { lastCheckupAt: at });
}

export async function createEntry(userId: string, input: EntryCreateInput) {
  if (input.parentId) await assertDepthAllowed(userId, input.parentId);

  const people = await ownedPersonIds(userId, input.people);
  // Auto-said: a direct mention means the person heard it, unless the client says otherwise.
  const saidToIds = input.saidTo === undefined ? people : await ownedPersonIds(userId, input.saidTo);
  const now = new Date();

  const entry = await Entry.create({
    userId,
    content: input.content,
    dateKey: input.dateKey,
    importance: input.importance,
    tags: await ownedTagIds(userId, input.tags),
    people,
    saidTo: saidToIds.map((person) => ({ person, at: now })),
    parentId: input.parentId ? new Types.ObjectId(input.parentId) : null,
  });
  await bumpLastCheckup(userId, saidToIds, now);
  const populated = await entry.populate(ENTRY_POPULATE);
  return entryToDto(populated.toObject() as unknown as LeanEntry);
}

export async function updateEntry(userId: string, entryId: string, input: EntryUpdateInput) {
  const entry = await Entry.findOne({ _id: entryId, userId });
  if (!entry) throw notFound('entry.not_found');

  if (input.content !== undefined) entry.content = input.content;
  if (input.dateKey !== undefined) entry.dateKey = input.dateKey;
  if (input.importance !== undefined) entry.importance = input.importance;
  if (input.tags !== undefined) entry.tags = await ownedTagIds(userId, input.tags);
  // Editing mentions intentionally does NOT touch saidTo (independently editable).
  if (input.people !== undefined) entry.people = await ownedPersonIds(userId, input.people);

  let newlySaid: Types.ObjectId[] = [];
  if (input.saidTo !== undefined) {
    const ids = await ownedPersonIds(userId, input.saidTo);
    const existingAt = new Map(entry.saidTo.map((s) => [s.person.toString(), s.at]));
    newlySaid = ids.filter((id) => !existingAt.has(id.toString()));
    const now = new Date();
    entry.set(
      'saidTo',
      ids.map((id) => ({ person: id, at: existingAt.get(id.toString()) ?? now })),
    );
  }
  if (input.hiddenFor !== undefined) entry.hiddenFor = await ownedPersonIds(userId, input.hiddenFor);

  await entry.save();
  if (newlySaid.length) await bumpLastCheckup(userId, newlySaid, new Date());
  const populated = await entry.populate(ENTRY_POPULATE);
  return entryToDto(populated.toObject() as unknown as LeanEntry);
}

/** Delete an entry and all of its descendants. Returns the number of deleted entries. */
export async function deleteEntry(userId: string, entryId: string) {
  const root = await Entry.findOne({ _id: entryId, userId }, '_id').lean();
  if (!root) throw notFound('entry.not_found');

  const toDelete = [root._id];
  let frontier = [root._id];
  while (frontier.length) {
    const children = await Entry.find({ userId, parentId: { $in: frontier } }, '_id').lean();
    frontier = children.map((c) => c._id);
    toDelete.push(...frontier);
  }
  await Entry.deleteMany({ userId, _id: { $in: toDelete } });
  return toDelete.length;
}

async function assertPersonOwned(userId: string, personId: string) {
  const person = await Person.findOne({ _id: personId, userId }, '_id').lean();
  if (!person) throw notFound('person.not_found');
}

export async function setSaid(userId: string, entryId: string, personId: string, said: boolean) {
  await assertPersonOwned(userId, personId);
  const pid = new Types.ObjectId(personId);
  const result = await Entry.updateOne(
    { _id: entryId, userId },
    { $pull: { saidTo: { person: pid } } },
  );
  if (!result.matchedCount) throw notFound('entry.not_found');
  if (said) {
    const now = new Date();
    await Entry.updateOne({ _id: entryId, userId }, { $push: { saidTo: { person: pid, at: now } } });
    await bumpLastCheckup(userId, [pid], now);
  }
}

export async function setHidden(userId: string, entryId: string, personId: string, hidden: boolean) {
  await assertPersonOwned(userId, personId);
  const update = hidden
    ? { $addToSet: { hiddenFor: new Types.ObjectId(personId) } }
    : { $pull: { hiddenFor: new Types.ObjectId(personId) } };
  const result = await Entry.updateOne({ _id: entryId, userId }, update);
  if (!result.matchedCount) throw notFound('entry.not_found');
}
