import type { EntryCreateInput, EntryUpdateInput } from '@diary/shared';
import { wouldExceedMaxDepth } from '@diary/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { Types } from 'mongoose';
import { badRequest, notFound } from '../errors';
import { recordDeletions } from '../models/deletion';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { Tag } from '../models/tag';
import { ENTRY_POPULATE, entryToDto, type LeanEntry } from '../dto';

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

/** A `saidTo` entry is either a bare person id (legacy — server stamps `at` itself) or an
    explicit `{personId, at}` pair (a client restoring history, e.g. a backup import). */
const saidToIdList = (input: EntryCreateInput['saidTo']): string[] =>
  (input ?? []).map((item) => (typeof item === 'string' ? item : item.personId));

/** Any explicit historical timestamps supplied, keyed by person id. Plain-id entries contribute
    nothing here, so old clients keep getting the "everyone said just now" fallback unchanged. */
const saidToProvidedAt = (input: EntryCreateInput['saidTo']): Map<string, Date> => {
  const map = new Map<string, Date>();
  for (const item of input ?? []) {
    if (typeof item !== 'string') map.set(item.personId, new Date(item.at));
  }
  return map;
};

/** 0-based depth of `id` itself (a root entry is depth 0). Throws if it isn't owned by userId. */
async function ancestorDepth(userId: string, id: string): Promise<number> {
  let depth = 0;
  let current = await Entry.findOne({ _id: id, userId }, 'parentId').lean();
  if (!current) throw notFound('entry.not_found');
  while (current.parentId) {
    depth += 1;
    current = await Entry.findOne({ _id: current.parentId, userId }, 'parentId').lean();
    if (!current) break;
  }
  return depth;
}

async function assertDepthAllowed(userId: string, parentId: string) {
  if (wouldExceedMaxDepth(await ancestorDepth(userId, parentId), 1)) throw badRequest('entry.max_depth');
}

/** Height of movedId's own subtree (BFS down, same frontier-walk shape as cascadeDateKey/
    deleteEntry below). A leaf is height 1. */
async function measureSubtreeHeight(userId: string, movedId: string): Promise<number> {
  let height = 1;
  let frontier = [new Types.ObjectId(movedId)];
  for (;;) {
    const children = await Entry.find({ userId, parentId: { $in: frontier } }, '_id').lean();
    if (!children.length) return height;
    height += 1;
    frontier = children.map((c) => c._id);
  }
}

/** Cycle guard: would `newParentId` make movedId its own ancestor (itself, or one of its
    descendants)? Same BFS shape as measureSubtreeHeight, checking membership as it goes. */
async function isMovingIntoOwnSubtree(
  userId: string,
  movedId: string,
  newParentId: string,
): Promise<boolean> {
  if (newParentId === movedId) return true;
  let frontier = [new Types.ObjectId(movedId)];
  for (;;) {
    const children = await Entry.find({ userId, parentId: { $in: frontier } }, '_id').lean();
    if (!children.length) return false;
    if (children.some((c) => c._id.toString() === newParentId)) return true;
    frontier = children.map((c) => c._id);
  }
}

/** Fractional-index key placing a new/moved entry after the current last sibling. Root-level
    siblings are scoped by dateKey (only same-day roots are ever siblings in the UI); sub-entry
    siblings are scoped by parentId alone (they always share their parent's dateKey). */
async function appendOrderKey(userId: string, parentId: string | null, dateKey: string): Promise<string> {
  const filter = parentId
    ? { userId, parentId: new Types.ObjectId(parentId) }
    : { userId, parentId: null, dateKey };
  const siblings = await Entry.find(filter, 'orderKey').lean();
  let max: string | null = null;
  for (const sibling of siblings) {
    if (sibling.orderKey && (max === null || sibling.orderKey > max)) max = sibling.orderKey;
  }
  return generateKeyBetween(max, null);
}

/** Bump the checkup clock: marking something as said counts as a real interaction.
    Only moves forward — a replayed offline mutation must not rewind it. Grouped by distinct `at`
    (rather than one shared timestamp for everyone) so restoring history — different people said
    to on different historical dates — bumps each to their own true date, not import time. */
async function bumpLastCheckup(userId: string, marks: { personId: Types.ObjectId; at: Date }[]) {
  if (!marks.length) return;
  const groups = new Map<number, { at: Date; ids: Types.ObjectId[] }>();
  for (const { personId, at } of marks) {
    const key = at.getTime();
    const group = groups.get(key);
    if (group) group.ids.push(personId);
    else groups.set(key, { at, ids: [personId] });
  }
  await Promise.all(
    [...groups.values()].map(({ at, ids }) =>
      Person.updateMany({ userId, _id: { $in: ids }, lastCheckupAt: { $lt: at } }, { lastCheckupAt: at }),
    ),
  );
}

export async function createEntry(userId: string, input: EntryCreateInput) {
  if (input.parentId) await assertDepthAllowed(userId, input.parentId);

  const people = await ownedPersonIds(userId, input.people);
  // Auto-said: a direct mention means the person heard it, unless the client says otherwise.
  const saidToIds =
    input.saidTo === undefined ? people : await ownedPersonIds(userId, saidToIdList(input.saidTo));
  const providedAt = saidToProvidedAt(input.saidTo);
  // Offline creates replay with their original timestamp so ordering within a day survives.
  const now = input.createdAt ? new Date(input.createdAt) : new Date();
  // Defense-in-depth for a client that predates orderKey — normally the client always sends one.
  const orderKey = input.orderKey ?? (await appendOrderKey(userId, input.parentId ?? null, input.dateKey));

  // timestamps off for this save: mongoose would otherwise force updatedAt = createdAt on new
  // docs, hiding replayed offline creates from other clients' sync cursors.
  const [entry] = await Entry.create(
    [
      {
        _id: input.id ? new Types.ObjectId(input.id) : new Types.ObjectId(),
        createdAt: now,
        updatedAt: new Date(),
        userId,
        content: input.content,
        dateKey: input.dateKey,
        importance: input.importance,
        tags: await ownedTagIds(userId, input.tags),
        people,
        saidTo: saidToIds.map((person) => ({ person, at: providedAt.get(person.toString()) ?? now })),
        parentId: input.parentId ? new Types.ObjectId(input.parentId) : null,
        orderKey,
      },
    ],
    { timestamps: false },
  );
  await bumpLastCheckup(
    userId,
    saidToIds.map((id) => ({ personId: id, at: providedAt.get(id.toString()) ?? now })),
  );
  const populated = await entry.populate(ENTRY_POPULATE);
  return entryToDto(populated.toObject() as unknown as LeanEntry);
}

/** Moving a parent's date must carry every descendant along with it. */
async function cascadeDateKey(userId: string, rootId: string, dateKey: string) {
  let frontier = [new Types.ObjectId(rootId)];
  while (frontier.length) {
    const children = await Entry.find({ userId, parentId: { $in: frontier } }, '_id').lean();
    if (!children.length) break;
    const ids = children.map((c) => c._id);
    await Entry.updateMany({ userId, _id: { $in: ids } }, { dateKey, updatedAt: new Date() });
    frontier = ids;
  }
}

export async function updateEntry(userId: string, entryId: string, input: EntryUpdateInput) {
  const entry = await Entry.findOne({ _id: entryId, userId });
  if (!entry) throw notFound('entry.not_found');

  const originalDateKey = entry.dateKey;
  const originalParentId = entry.parentId ? entry.parentId.toString() : null;

  if (input.content !== undefined) entry.content = input.content;
  if (input.dateKey !== undefined) entry.dateKey = input.dateKey;
  if (input.importance !== undefined) entry.importance = input.importance;
  if (input.tags !== undefined) entry.tags = await ownedTagIds(userId, input.tags);
  // Editing mentions intentionally does NOT touch saidTo (independently editable).
  if (input.people !== undefined) entry.people = await ownedPersonIds(userId, input.people);

  let newlySaid: Types.ObjectId[] = [];
  let providedAt = new Map<string, Date>();
  if (input.saidTo !== undefined) {
    const ids = await ownedPersonIds(userId, saidToIdList(input.saidTo));
    const existingAt = new Map(entry.saidTo.map((s) => [s.person.toString(), s.at]));
    providedAt = saidToProvidedAt(input.saidTo);
    newlySaid = ids.filter((id) => !existingAt.has(id.toString()));
    const now = new Date();
    entry.set(
      'saidTo',
      ids.map((id) => ({
        person: id,
        at: existingAt.get(id.toString()) ?? providedAt.get(id.toString()) ?? now,
      })),
    );
  }
  if (input.hiddenFor !== undefined) entry.hiddenFor = await ownedPersonIds(userId, input.hiddenFor);

  // Reparent: dragging elsewhere in the tree, or promoting to root with parentId: null.
  const parentChanging = input.parentId !== undefined && input.parentId !== originalParentId;
  if (parentChanging && input.parentId) {
    const newParent = await Entry.findOne({ _id: input.parentId, userId }, '_id').lean();
    if (!newParent) throw notFound('entry.not_found');
    if (await isMovingIntoOwnSubtree(userId, entryId, input.parentId)) throw badRequest('entry.cycle');
    const targetParentDepth = await ancestorDepth(userId, input.parentId);
    const movedHeight = await measureSubtreeHeight(userId, entryId);
    if (wouldExceedMaxDepth(targetParentDepth, movedHeight)) throw badRequest('entry.max_depth');
  }
  if (parentChanging) entry.parentId = input.parentId ? new Types.ObjectId(input.parentId) : null;

  const dateChanging = input.dateKey !== undefined && input.dateKey !== originalDateKey;
  if (input.orderKey !== undefined) {
    entry.orderKey = input.orderKey;
  } else if (parentChanging || dateChanging) {
    // No explicit position from the client (an older client, or the plain "edit the date" path,
    // which doesn't know about orderKey): land at the bottom of the new sibling group.
    const parentId = entry.parentId ? entry.parentId.toString() : null;
    entry.orderKey = await appendOrderKey(userId, parentId, entry.dateKey);
  }

  await entry.save();
  if (dateChanging) {
    await cascadeDateKey(userId, entryId, input.dateKey!);
  }
  if (newlySaid.length) {
    await bumpLastCheckup(
      userId,
      newlySaid.map((id) => ({ personId: id, at: providedAt.get(id.toString()) ?? new Date() })),
    );
  }
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
  await recordDeletions(userId, 'entry', toDelete);
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
    await bumpLastCheckup(userId, [{ personId: pid, at: now }]);
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
