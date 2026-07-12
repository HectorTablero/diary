import type {
  EntryCreateInput,
  EntryDto,
  EntryUpdateInput,
  PersonCreateInput,
  PersonDto,
  PersonUpdateInput,
  SaidMark,
  SettingsDto,
  SettingsInput,
  TagCreateInput,
  TagDto,
  TagUpdateInput,
} from '@diary/shared';
import { DEFAULT_TAG_COLORS, newObjectId } from '@diary/shared';
import { ApiError } from '@/lib/apiClient';
import { fuzzyEquals } from '@/lib/tokens';
import { db, type LocalEntry, type OutboxOp } from './db';
import { getDayEntries, getPerson, getSettings } from './repo';
import { kick } from './sync';

/* Local write layer: every mutation applies to Dexie immediately (the UI is
   optimistic by construction) and queues the equivalent REST call for replay.
   The rules here mirror the server services so both sides converge. */

async function enqueue(method: OutboxOp['method'], path: string, body?: unknown): Promise<void> {
  await db.outbox.add({ method, path, body });
  kick();
}

const nowIso = () => new Date().toISOString();

/** Marking something as said counts as an interaction; only ever moves forward. */
async function bumpLastCheckup(personIds: string[], at: string): Promise<void> {
  if (!personIds.length) return;
  await db.people
    .where('id')
    .anyOf(personIds)
    .modify((p) => {
      if (p.lastCheckupAt < at) p.lastCheckupAt = at;
    });
}

async function entryDto(entryId: string, dateKey: string): Promise<EntryDto> {
  // Reuse the read path (joins included) rather than duplicating the mapping.
  const flatten = (nodes: EntryDto[]): EntryDto | undefined => {
    for (const node of nodes as (EntryDto & { children: EntryDto[] })[]) {
      if (node.id === entryId) return node;
      const found = flatten(node.children);
      if (found) return found;
    }
    return undefined;
  };
  const found = flatten(await getDayEntries(dateKey));
  if (!found) throw new ApiError(404, 'entry.not_found');
  return found;
}

// --- Entries ---

export async function createEntry(input: EntryCreateInput): Promise<EntryDto> {
  const id = input.id ?? newObjectId();
  const createdAt = input.createdAt ?? nowIso();
  // Auto-said: a direct mention means the person heard it, unless the client says otherwise.
  const saidToIds = input.saidTo === undefined ? input.people : input.saidTo;

  const entry: LocalEntry = {
    id,
    content: input.content,
    dateKey: input.dateKey,
    importance: input.importance,
    tagIds: input.tags,
    peopleIds: input.people,
    saidTo: saidToIds.map((personId) => ({ personId, at: createdAt })),
    hiddenFor: [],
    parentId: input.parentId ?? null,
    createdAt,
    updatedAt: createdAt,
  };
  await db.entries.add(entry);
  await bumpLastCheckup(saidToIds, createdAt);
  await enqueue('POST', '/entries', { ...input, id, createdAt });
  return entryDto(id, input.dateKey);
}

export async function updateEntry(entryId: string, input: EntryUpdateInput): Promise<EntryDto> {
  const entry = await db.entries.get(entryId);
  if (!entry) throw new ApiError(404, 'entry.not_found');

  const now = nowIso();
  let newlySaid: string[] = [];
  let saidTo = entry.saidTo;
  if (input.saidTo !== undefined) {
    const existingAt = new Map(entry.saidTo.map((s) => [s.personId, s.at]));
    newlySaid = input.saidTo.filter((id) => !existingAt.has(id));
    saidTo = input.saidTo.map(
      (personId): SaidMark => ({ personId, at: existingAt.get(personId) ?? now }),
    );
  }

  const updated: LocalEntry = {
    ...entry,
    content: input.content ?? entry.content,
    dateKey: input.dateKey ?? entry.dateKey,
    importance: input.importance ?? entry.importance,
    tagIds: input.tags ?? entry.tagIds,
    // Editing mentions intentionally does NOT touch saidTo (independently editable).
    peopleIds: input.people ?? entry.peopleIds,
    saidTo,
    hiddenFor: input.hiddenFor ?? entry.hiddenFor,
    updatedAt: now,
  };
  await db.entries.put(updated);
  await bumpLastCheckup(newlySaid, now);
  await enqueue('PATCH', `/entries/${entryId}`, input);
  return entryDto(entryId, updated.dateKey);
}

/** Delete an entry and all of its descendants (the server cascades the same way). */
export async function deleteEntry(entryId: string): Promise<{ deleted: number }> {
  const toDelete = [entryId];
  let frontier = [entryId];
  while (frontier.length) {
    const children = await db.entries.where('parentId').anyOf(frontier).toArray();
    frontier = children.map((c) => c.id);
    toDelete.push(...frontier);
  }
  await db.entries.bulkDelete(toDelete);
  await enqueue('DELETE', `/entries/${entryId}`);
  return { deleted: toDelete.length };
}

export async function setSaid(entryId: string, personId: string, said: boolean): Promise<void> {
  const now = nowIso();
  await db.entries
    .where('id')
    .equals(entryId)
    .modify((entry) => {
      entry.saidTo = entry.saidTo.filter((s) => s.personId !== personId);
      if (said) entry.saidTo.push({ personId, at: now });
      entry.updatedAt = now;
    });
  if (said) await bumpLastCheckup([personId], now);
  await enqueue(said ? 'PUT' : 'DELETE', `/entries/${entryId}/said/${personId}`);
}

export async function setHidden(entryId: string, personId: string, hidden: boolean): Promise<void> {
  await db.entries
    .where('id')
    .equals(entryId)
    .modify((entry) => {
      entry.hiddenFor = entry.hiddenFor.filter((id) => id !== personId);
      if (hidden) entry.hiddenFor.push(personId);
      entry.updatedAt = nowIso();
    });
  await enqueue(hidden ? 'PUT' : 'DELETE', `/entries/${entryId}/hidden/${personId}`);
}

// --- People ---

async function assertUniquePersonName(name: string, exceptId?: string): Promise<void> {
  const clash = (await db.people.toArray()).find(
    (p) => p.id !== exceptId && fuzzyEquals(p.name, name),
  );
  if (clash) throw new ApiError(409, 'person.duplicate_name');
}

export async function createPerson(input: PersonCreateInput): Promise<PersonDto> {
  await assertUniquePersonName(input.name);
  const id = input.id ?? newObjectId();
  const createdAt = input.createdAt ?? nowIso();
  const checkupIntervalDays =
    input.checkupIntervalDays !== undefined
      ? input.checkupIntervalDays
      : (await getSettings()).defaultCheckupIntervalDays;

  await db.people.add({
    id,
    name: input.name,
    tagIds: input.tags,
    notes: input.notes,
    checkupIntervalDays,
    lastCheckupAt: createdAt,
    createdAt,
  });
  await enqueue('POST', '/people', { ...input, id, createdAt, checkupIntervalDays });
  return getPerson(id);
}

export async function updatePerson(personId: string, input: PersonUpdateInput): Promise<PersonDto> {
  if (input.name !== undefined) await assertUniquePersonName(input.name, personId);
  const count = await db.people
    .where('id')
    .equals(personId)
    .modify((p) => {
      if (input.name !== undefined) p.name = input.name;
      if (input.notes !== undefined) p.notes = input.notes;
      if (input.tags !== undefined) p.tagIds = input.tags;
      if (input.checkupIntervalDays !== undefined) p.checkupIntervalDays = input.checkupIntervalDays;
    });
  if (!count) throw new ApiError(404, 'person.not_found');
  await enqueue('PATCH', `/people/${personId}`, input);
  return getPerson(personId);
}

export async function deletePerson(personId: string): Promise<void> {
  await db.people.delete(personId);
  // Mirror the server cascade: pull the person out of every entry.
  await db.entries
    .filter(
      (e) =>
        e.peopleIds.includes(personId) ||
        e.hiddenFor.includes(personId) ||
        e.saidTo.some((s) => s.personId === personId),
    )
    .modify((e) => {
      e.peopleIds = e.peopleIds.filter((id) => id !== personId);
      e.hiddenFor = e.hiddenFor.filter((id) => id !== personId);
      e.saidTo = e.saidTo.filter((s) => s.personId !== personId);
    });
  await enqueue('DELETE', `/people/${personId}`);
}

export async function markCheckup(personId: string): Promise<PersonDto> {
  const count = await db.people
    .where('id')
    .equals(personId)
    .modify((p) => {
      p.lastCheckupAt = nowIso();
    });
  if (!count) throw new ApiError(404, 'person.not_found');
  await enqueue('PUT', `/people/${personId}/checkup`);
  return getPerson(personId);
}

// --- Tags ---

async function assertUniqueTagName(name: string, exceptId?: string): Promise<void> {
  const clash = (await db.tags.toArray()).find(
    (t) => t.id !== exceptId && fuzzyEquals(t.name, name),
  );
  if (clash) throw new ApiError(409, 'tag.duplicate_name');
}

/** First palette color not yet in use (cycles when all are taken) — same rule as the server. */
async function nextColor(): Promise<string> {
  const used = new Set((await db.tags.toArray()).map((t) => t.color));
  return (
    DEFAULT_TAG_COLORS.find((c) => !used.has(c)) ??
    DEFAULT_TAG_COLORS[used.size % DEFAULT_TAG_COLORS.length]
  );
}

export async function createTag(input: TagCreateInput): Promise<TagDto> {
  await assertUniqueTagName(input.name);
  const id = input.id ?? newObjectId();
  const tag: TagDto = { id, name: input.name, color: input.color ?? (await nextColor()) };
  await db.tags.add(tag);
  // Color resolved locally so the server stores the exact same one.
  await enqueue('POST', '/tags', { ...input, id, createdAt: input.createdAt ?? nowIso(), color: tag.color });
  return tag;
}

export async function updateTag(tagId: string, input: TagUpdateInput): Promise<TagDto> {
  if (input.name !== undefined) await assertUniqueTagName(input.name, tagId);
  const count = await db.tags
    .where('id')
    .equals(tagId)
    .modify((t) => {
      if (input.name !== undefined) t.name = input.name;
      if (input.color !== undefined) t.color = input.color;
    });
  if (!count) throw new ApiError(404, 'tag.not_found');
  await enqueue('PATCH', `/tags/${tagId}`, input);
  return (await db.tags.get(tagId))!;
}

export async function deleteTag(tagId: string): Promise<void> {
  await db.tags.delete(tagId);
  await db.entries
    .where('tagIds')
    .equals(tagId)
    .modify((e) => {
      e.tagIds = e.tagIds.filter((id) => id !== tagId);
    });
  await db.people
    .filter((p) => p.tagIds.includes(tagId))
    .modify((p) => {
      p.tagIds = p.tagIds.filter((id) => id !== tagId);
    });
  await enqueue('DELETE', `/tags/${tagId}`);
}

// --- Settings ---

export async function saveSettings(input: SettingsInput): Promise<SettingsDto> {
  const settings: SettingsDto = { ...input };
  await db.meta.put({ key: 'settings', value: settings });
  await enqueue('PUT', '/settings', input);
  return settings;
}
