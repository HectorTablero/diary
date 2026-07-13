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
import { DEFAULT_TAG_COLORS, MAX_ALIASES, newObjectId } from '@diary/shared';
import { ApiError } from '@/lib/apiClient';
import type { ContactCandidate, Resolution } from '@/lib/conflicts';
import { refreshNotifications } from '@/lib/notifications';
import { fuzzyEquals, renameMentions } from '@/lib/tokens';
import { db, type LocalEntry, type LocalPerson, type OutboxOp } from './db';
import { getDayEntries, getPerson, getSettings } from './repo';
import { kick } from './sync';

/* Local write layer: every mutation applies to Dexie immediately (the UI is
   optimistic by construction) and queues the equivalent REST call for replay.
   The rules here mirror the server services so both sides converge. */

async function enqueue(method: OutboxOp['method'], path: string, body?: unknown): Promise<void> {
  await db.outbox.add({ method, path, body });
  kick();
  refreshNotifications();
}

/** Queue many ops at once, kicking sync and rescheduling notifications a single time.
    Importing 200 contacts through `enqueue` would otherwise run 200 full notification
    reconciles, each of which re-reads every person. */
async function enqueueBatch(ops: OutboxOp[]): Promise<void> {
  if (!ops.length) return;
  await db.outbox.bulkAdd(ops);
  kick();
  refreshNotifications();
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

/** Moving a parent's date must carry every descendant along with it. */
async function cascadeDateKey(rootId: string, dateKey: string, at: string): Promise<void> {
  let frontier = [rootId];
  while (frontier.length) {
    const children = await db.entries.where('parentId').anyOf(frontier).toArray();
    if (!children.length) break;
    await db.entries.bulkPut(children.map((c) => ({ ...c, dateKey, updatedAt: at })));
    frontier = children.map((c) => c.id);
  }
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
  if (input.dateKey !== undefined && input.dateKey !== entry.dateKey) {
    await cascadeDateKey(entryId, input.dateKey, now);
  }
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

/** A name must not collide with another person's name *or* one of their aliases — otherwise
    `@Name` would be ambiguous, and the server's unique index would reject the create anyway. */
async function assertUniquePersonName(name: string, exceptId?: string): Promise<void> {
  const clash = (await db.people.toArray()).find(
    (p) =>
      p.id !== exceptId &&
      (fuzzyEquals(p.name, name) || (p.aliases ?? []).some((alias) => fuzzyEquals(alias, name))),
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
    aliases: input.aliases ?? [],
    phone: input.phone ?? null,
    email: input.email ?? null,
    wechatId: input.wechatId ?? null,
    birthday: input.birthday ?? null,
    company: input.company ?? null,
    jobTitle: input.jobTitle ?? null,
    contactId: input.contactId ?? null,
    tagIds: input.tags,
    notes: input.notes,
    checkupIntervalDays,
    lastCheckupAt: createdAt,
    createdAt,
  });
  await enqueue('POST', '/people', { ...input, id, createdAt, checkupIntervalDays });
  return getPerson(id);
}

/** Rewrite every entry's literal @OldName text to @NewName after a person rename
    (the structured peopleIds link is already correct — only the mention text is stale). */
async function renamePersonMentions(personId: string, oldName: string, newName: string): Promise<void> {
  const entries = await db.entries.where('peopleIds').equals(personId).toArray();
  if (!entries.length) return;
  const nameById = new Map((await db.people.toArray()).map((p) => [p.id, p.name]));
  nameById.set(personId, oldName);
  const now = nowIso();
  for (const entry of entries) {
    const names = entry.peopleIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => n !== undefined);
    const content = renameMentions(entry.content, '@', names, oldName, newName);
    if (content === entry.content) continue;
    await db.entries.update(entry.id, { content, updatedAt: now });
    await enqueue('PATCH', `/entries/${entry.id}`, { content });
  }
}

export async function updatePerson(personId: string, input: PersonUpdateInput): Promise<PersonDto> {
  if (input.name !== undefined) await assertUniquePersonName(input.name, personId);
  let oldName: string | undefined;
  const count = await db.people
    .where('id')
    .equals(personId)
    .modify((p) => {
      oldName = p.name;
      if (input.name !== undefined) p.name = input.name;
      if (input.aliases !== undefined) p.aliases = input.aliases;
      if (input.phone !== undefined) p.phone = input.phone;
      if (input.email !== undefined) p.email = input.email;
      if (input.wechatId !== undefined) p.wechatId = input.wechatId;
      if (input.birthday !== undefined) p.birthday = input.birthday;
      if (input.company !== undefined) p.company = input.company;
      if (input.jobTitle !== undefined) p.jobTitle = input.jobTitle;
      if (input.contactId !== undefined) p.contactId = input.contactId;
      if (input.notes !== undefined) p.notes = input.notes;
      if (input.tags !== undefined) p.tagIds = input.tags;
      if (input.checkupIntervalDays !== undefined) p.checkupIntervalDays = input.checkupIntervalDays;
    });
  if (!count) throw new ApiError(404, 'person.not_found');
  if (input.name !== undefined && oldName !== undefined && !fuzzyEquals(input.name, oldName)) {
    await renamePersonMentions(personId, oldName, input.name);
  }
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

/** Fields a merge may fill in, plus the aliases it may learn. */
function mergePatch(target: LocalPerson, candidate: ContactCandidate): PersonUpdateInput | null {
  const patch: PersonUpdateInput = {};
  // Only ever fill blanks — an import must never overwrite something the user typed themselves.
  if (!target.phone && candidate.phone) patch.phone = candidate.phone;
  if (!target.email && candidate.email) patch.email = candidate.email;
  if (!target.birthday && candidate.birthday) patch.birthday = candidate.birthday;
  if (!target.company && candidate.company) patch.company = candidate.company;
  if (!target.jobTitle && candidate.jobTitle) patch.jobTitle = candidate.jobTitle;
  if (!target.contactId && candidate.contactId) patch.contactId = candidate.contactId;

  // The contact's own name becomes an alias when it differs from the person's — merging the
  // contact "Mum" into "Carmen" is what teaches the app that @Mum means Carmen.
  const existing = target.aliases ?? [];
  const merged = [...existing];
  for (const alias of [candidate.name, ...candidate.aliases]) {
    if (fuzzyEquals(alias, target.name)) continue;
    if (merged.some((known) => fuzzyEquals(known, alias))) continue;
    merged.push(alias);
  }
  if (merged.length !== existing.length) patch.aliases = merged.slice(0, MAX_ALIASES);

  return Object.keys(patch).length ? patch : null;
}

export interface ImportItem {
  /** The candidate as resolved in the review step — `name` may have been edited there. */
  candidate: ContactCandidate;
  resolution: Resolution;
}

/**
 * Apply a fully-resolved import plan. Conflicts must already be settled: this queues one
 * `POST /people` per created person, and a 409 from the server would make sync.ts delete the
 * local row as a phantom (see sync.ts:102). The review step is what guarantees that can't happen.
 *
 * Creates go in as one bulk write plus one outbox op each — per-person ops keep `dirtyIds()` and
 * `removeLocalDoc()` working unchanged, and the UI is local-first so nobody waits on the queue.
 */
export async function importPeople(items: ImportItem[]): Promise<{ created: number; merged: number }> {
  // Read settings and people once. Looping over createPerson() would re-read every person on
  // every single call (assertUniquePersonName does a full table scan) — O(n²) on a 500-contact
  // address book.
  const [settings, existing] = await Promise.all([getSettings(), db.people.toArray()]);
  const byId = new Map(existing.map((person) => [person.id, person]));
  const now = nowIso();

  const creates: LocalPerson[] = [];
  const updates: LocalPerson[] = [];
  const ops: OutboxOp[] = [];

  for (const { candidate, resolution } of items) {
    if (resolution.action === 'skip') continue;

    if (resolution.action === 'merge') {
      const target = byId.get(resolution.personId);
      if (!target) continue; // deleted underneath us; nothing sensible to merge into
      const patch = mergePatch(target, candidate);
      if (!patch) continue; // the person already knows everything this contact could tell us
      updates.push({
        ...target,
        aliases: patch.aliases ?? target.aliases,
        phone: patch.phone ?? target.phone,
        email: patch.email ?? target.email,
        birthday: patch.birthday ?? target.birthday,
        company: patch.company ?? target.company,
        jobTitle: patch.jobTitle ?? target.jobTitle,
        contactId: patch.contactId ?? target.contactId,
      });
      ops.push({ method: 'PATCH', path: `/people/${target.id}`, body: patch });
      continue;
    }

    const id = newObjectId();
    const person: LocalPerson = {
      id,
      name: candidate.name,
      aliases: candidate.aliases,
      phone: candidate.phone,
      email: candidate.email,
      wechatId: null,
      birthday: candidate.birthday,
      company: candidate.company,
      jobTitle: candidate.jobTitle,
      contactId: candidate.contactId,
      tagIds: [],
      notes: '',
      checkupIntervalDays: settings.defaultCheckupIntervalDays,
      lastCheckupAt: now,
      createdAt: now,
    };
    creates.push(person);
    ops.push({
      method: 'POST',
      path: '/people',
      body: {
        id,
        createdAt: now,
        name: person.name,
        aliases: person.aliases,
        phone: person.phone,
        email: person.email,
        birthday: person.birthday,
        company: person.company,
        jobTitle: person.jobTitle,
        contactId: person.contactId,
        tags: [],
        notes: '',
        checkupIntervalDays: person.checkupIntervalDays,
      },
    });
  }

  await db.transaction('rw', db.people, async () => {
    if (creates.length) await db.people.bulkAdd(creates);
    if (updates.length) await db.people.bulkPut(updates);
  });
  await enqueueBatch(ops);

  return { created: creates.length, merged: updates.length };
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

/** Rewrite every entry's literal #oldtag text to #newtag after a tag rename
    (the structured tagIds link is already correct — only the mention text is stale). */
async function renameTagMentions(tagId: string, oldName: string, newName: string): Promise<void> {
  const entries = await db.entries.where('tagIds').equals(tagId).toArray();
  if (!entries.length) return;
  const nameById = new Map((await db.tags.toArray()).map((t) => [t.id, t.name]));
  nameById.set(tagId, oldName);
  const now = nowIso();
  for (const entry of entries) {
    const names = entry.tagIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => n !== undefined);
    const content = renameMentions(entry.content, '#', names, oldName, newName);
    if (content === entry.content) continue;
    await db.entries.update(entry.id, { content, updatedAt: now });
    await enqueue('PATCH', `/entries/${entry.id}`, { content });
  }
}

export async function updateTag(tagId: string, input: TagUpdateInput): Promise<TagDto> {
  if (input.name !== undefined) await assertUniqueTagName(input.name, tagId);
  let oldName: string | undefined;
  const count = await db.tags
    .where('id')
    .equals(tagId)
    .modify((t) => {
      oldName = t.name;
      if (input.name !== undefined) t.name = input.name;
      if (input.color !== undefined) t.color = input.color;
    });
  if (!count) throw new ApiError(404, 'tag.not_found');
  if (input.name !== undefined && oldName !== undefined && !fuzzyEquals(input.name, oldName)) {
    await renameTagMentions(tagId, oldName, input.name);
  }
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
  // Merge over the current settings (not just DEFAULT_SETTINGS) so fields the caller
  // didn't touch — like an optional groqApiKey — survive instead of being blanked.
  const current = await getSettings();
  const settings: SettingsDto = { ...current, ...input };
  await db.meta.put({ key: 'settings', value: settings });
  await enqueue('PUT', '/settings', input);
  return settings;
}
