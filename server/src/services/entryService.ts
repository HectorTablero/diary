import type { EntryCreateInput, EntryUpdateInput } from '@diary/shared';
import {
  depthOf,
  descendantIds,
  isSelfOrDescendant,
  subtreeHeightFrom,
  wouldExceedMaxDepth,
} from '@diary/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { Types } from 'mongoose';
import { badRequest, conflict, isDuplicateKey, notFound } from '../errors';
import { clearDeletions, recordDeletions } from '../models/deletion';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { Tag } from '../models/tag';
import { Thread } from '../models/thread';
import { getSettings } from './settingsService';
import { ENTRY_POPULATE, entryToDto, type LeanEntry } from '../dto';

const toObjectIds = (ids: string[]) => ids.map((id) => new Types.ObjectId(id));

/** Keep only ids that actually belong to this user. */
async function ownedTagIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const tags = await Tag.find({ userId, _id: { $in: toObjectIds(ids) } }, '_id').lean();
  return tags.map((t) => t._id);
}

async function ownedThreadIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const threads = await Thread.find({ userId, _id: { $in: toObjectIds(ids) } }, '_id').lean();
  return threads.map((t) => t._id);
}

async function ownedPersonIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const people = await Person.find({ userId, _id: { $in: toObjectIds(ids) } }, '_id').lean();
  return people.map((p) => p._id);
}

/** A `saidTo` entry is either a bare person id (legacy — server stamps `at` itself) or an
    explicit `{personId, at}` pair (a client restoring history, e.g. a backup import). */
export const saidToIdList = (input: EntryCreateInput['saidTo']): string[] =>
  (input ?? []).map((item) => (typeof item === 'string' ? item : item.personId));

/** Any explicit historical timestamps supplied, keyed by person id. Plain-id entries contribute
    nothing here, so old clients keep getting the "everyone said just now" fallback unchanged. */
export const saidToProvidedAt = (input: EntryCreateInput['saidTo']): Map<string, Date> => {
  const map = new Map<string, Date>();
  for (const item of input ?? []) {
    if (typeof item !== 'string') map.set(item.personId, new Date(item.at));
  }
  return map;
};

/**
 * Every entry this user owns, as an id -> parentId map.
 *
 * One query, then all the tree questions are answered from shared/tree.ts — the same functions the
 * client validates a drag against, so the two can no longer disagree about whether a drop is legal.
 * The walks this replaced each cost a round-trip per level: `ancestorDepth` in particular issued a
 * findOne for every ancestor, so validating a move at depth 4 was five sequential queries.
 *
 * Projected to two fields, and a diary is thousands of rows rather than millions.
 */
async function parentMap(userId: string): Promise<Map<string, string | null>> {
  const rows = await Entry.find({ userId }, '_id parentId').lean();
  return new Map(
    rows.map((row) => [row._id.toString(), row.parentId ? row.parentId.toString() : null]),
  );
}

/** 0-based depth of `id` itself (a root entry is depth 0). Throws if it isn't owned by userId. */
async function ancestorDepth(userId: string, id: string): Promise<number> {
  const exists = await Entry.exists({ _id: id, userId });
  if (!exists) throw notFound('entry.not_found');
  return depthOf(id, await parentMap(userId));
}

/** How deep this user allows nesting. Read per call rather than cached: it is one indexed lookup
    on a row this request has usually touched already, and a stale copy would reject a legal edit. */
async function maxDepthFor(userId: string): Promise<number> {
  return (await getSettings(userId)).maxSubEntryDepth;
}

async function assertDepthAllowed(userId: string, parentId: string) {
  const [depth, maxDepth] = await Promise.all([ancestorDepth(userId, parentId), maxDepthFor(userId)]);
  if (wouldExceedMaxDepth(depth, 1, maxDepth)) throw badRequest('entry.max_depth');
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

/**
 * Was this create's failure just a replay of one that already succeeded? If so, hand back the
 * entry that is already there.
 *
 * The outbox deletes an op only once its response arrives, so a create whose response is lost to a
 * dropped connection stays queued and is sent again — as is the second press of an Undo button.
 * Answering that with a 409 is actively harmful: the client reads a 409 on POST as "this create
 * never reached the server, my local copy is a phantom" and deletes the row (see removeLocalDoc in
 * web/src/db/sync.ts), which is undo throwing away the very entry it just restored. The document
 * exists under the id we were asked to use, so the create has succeeded; say so.
 *
 * Scoped to `userId` deliberately: ids are client-generated, and an id that collides with *another
 * user's* document is a genuine conflict, never something to hand back.
 */
async function replayedCreate(err: unknown, userId: string, id: string | undefined) {
  if (!id || !isDuplicateKey(err, '_id')) return null;
  const existing = await Entry.findOne({ _id: id, userId }).populate(ENTRY_POPULATE).lean();
  if (!existing) throw conflict('errors.duplicate');
  return entryToDto(existing as unknown as LeanEntry);
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
  let entry;
  try {
    [entry] = await Entry.create(
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
          threads: await ownedThreadIds(userId, input.threads),
          people,
          saidTo: saidToIds.map((person) => ({ person, at: providedAt.get(person.toString()) ?? now })),
          parentId: input.parentId ? new Types.ObjectId(input.parentId) : null,
          orderKey,
        },
      ],
      { timestamps: false },
    );
  } catch (err) {
    const existing = await replayedCreate(err, userId, input.id);
    if (existing) return existing;
    throw err;
  }
  // Only a client-supplied id can collide with a tombstone — a fresh ObjectId has never been
  // deleted, so there is nothing to retract for an ordinary create.
  if (input.id) await clearDeletions(userId, 'entry', [entry._id]);
  await bumpLastCheckup(
    userId,
    saidToIds.map((id) => ({ personId: id, at: providedAt.get(id.toString()) ?? now })),
  );
  const populated = await entry.populate(ENTRY_POPULATE);
  return entryToDto(populated.toObject() as unknown as LeanEntry);
}

/** Moving a parent's date must carry every descendant along with it. */
async function cascadeDateKey(userId: string, rootId: string, dateKey: string) {
  const ids = [...descendantIds(rootId, await parentMap(userId))];
  if (!ids.length) return;
  // One update for the whole subtree rather than one per level, and every row gets the same
  // updatedAt — so a client's sync cursor cannot land between two levels of the same move.
  await Entry.updateMany({ userId, _id: { $in: toObjectIds(ids) } }, { dateKey, updatedAt: new Date() });
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
  if (input.threads !== undefined) entry.threads = await ownedThreadIds(userId, input.threads);
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
    /* One read of the tree answers all three questions, where this used to issue a query per level
       for each of them in turn. The map is taken before the move is applied, which is what makes
       the cycle check meaningful — it describes where things currently are. */
    const tree = await parentMap(userId);
    if (isSelfOrDescendant(input.parentId, entryId, tree)) throw badRequest('entry.cycle');
    const targetParentDepth = depthOf(input.parentId, tree);
    const movedHeight = subtreeHeightFrom(entryId, tree);
    if (wouldExceedMaxDepth(targetParentDepth, movedHeight, await maxDepthFor(userId))) {
      throw badRequest('entry.max_depth');
    }
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

  // The entry plus everything under it — a tombstone has to be recorded for each, or the subtree
  // would come back on the next sync of a client that still has it.
  const toDelete = toObjectIds([entryId, ...descendantIds(entryId, await parentMap(userId))]);
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
