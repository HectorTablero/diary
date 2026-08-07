import type {
  EntryCreateInput,
  EntryDto,
  EntryUpdateInput,
  PersonCreateInput,
  PersonDto,
  PersonEventDto,
  PersonEventInput,
  PersonUpdateInput,
  SaidMark,
  SettingsDto,
  SettingsInput,
  TagCreateInput,
  TagDto,
  TagUpdateInput,
  ThreadCreateInput,
  ThreadDto,
  ThreadUpdateInput,
} from '@diary/shared';
import {
  DEFAULT_TAG_COLORS,
  isSelfOrDescendant,
  MAX_ALIASES,
  newObjectId,
  wouldExceedMaxDepth,
} from '@diary/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { ApiError } from '@/lib/apiClient';
import type { BackupResolution } from '@/lib/backup/conflicts';
import type {
  EntryBackupRow,
  PersonBackupRow,
  TagBackupRow,
  ThreadBackupRow,
} from '@/lib/backup/schema';
import type { ContactCandidate, Resolution } from '@/lib/conflicts';
import { fuzzyEquals, renameMentions } from '@/lib/tokens';
import { db, type LocalEntry, type LocalPerson, type OutboxOp } from './db';
import { enqueue, enqueueBatch } from './outbox';
import { getDayEntries, getPerson, getSettings } from './repo';

/* Local write layer: every mutation applies to Dexie immediately (the UI is
   optimistic by construction) and queues the equivalent REST call for replay.
   The rules here mirror the server services so both sides converge. */

const nowIso = () => new Date().toISOString();

/* --- Undoable deletions -----------------------------------------------------------------------

   Every delete returns a snapshot of exactly what it removed, and has a matching `restore*` that
   puts it back. Two things make this cheap rather than a soft-delete rewrite:

   - a delete already reads everything it is about to remove (the cascades below need the rows to
     know what to touch), so the snapshot is that read kept instead of thrown away, and
   - the create endpoints accept client-generated ids, so a restore re-creates the *same* rows
     rather than copies. The outbox is FIFO, so a queued DELETE followed by the restore's POST
     replays as delete-then-recreate and converges on "exists" either way — which means undo is
     correct whether or not the delete already reached the server.

   The snapshot lives in the toast's closure and dies with it. Nothing is persisted, so undo is
   deliberately only available for as long as the toast is on screen. */

/** An entry and all of its descendants, parents first. */
export interface EntryDeletion {
  kind: 'entry';
  entries: LocalEntry[];
}

/** The mention/said/hidden marks one entry carried for a person, as they were before the cascade. */
export interface EntryPersonLink {
  entryId: string;
  peopleIds: string[];
  hiddenFor: string[];
  saidTo: SaidMark[];
}

export interface PersonDeletion {
  kind: 'person';
  person: LocalPerson;
  links: EntryPersonLink[];
}

export interface TagDeletion {
  kind: 'tag';
  tag: TagDto;
  entryIds: string[];
  peopleIds: string[];
}

export interface ThreadDeletion {
  kind: 'thread';
  thread: ThreadDto;
  entryIds: string[];
}

export interface EventDeletion {
  kind: 'event';
  personId: string;
  event: PersonEventDto;
  person: PersonDto;
}

/** A saidTo entry is either a bare person id or an explicit `{personId, at}` pair (see shared's
    saidToInputSchema — the wider shape exists so importEntries can preserve historical
    timestamps). Ordinary entry composition never supplies a historical `at`, so these local
    writes just need the id list. */
const saidToIdList = (input: EntryCreateInput['saidTo'] | EntryUpdateInput['saidTo']): string[] =>
  (input ?? []).map((item) => (typeof item === 'string' ? item : item.personId));

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

/** Fractional-index key placing a new/moved entry after the current last sibling. Root-level
    siblings (parentId: null) can't be range-queried by Dexie's `parentId` index — IndexedDB
    doesn't accept `null` as an index key — so, like getCalendarMonth in repo.ts, fetch by the
    dateKey index and filter parentId in memory instead. Sub-entry siblings always share their
    parent's dateKey, so a plain parentId query is enough for them. */
async function bottomOrderKey(parentId: string | null, dateKey: string): Promise<string> {
  const siblings = parentId
    ? await db.entries.where('parentId').equals(parentId).toArray()
    : (await db.entries.where('dateKey').equals(dateKey).toArray()).filter((e) => e.parentId === null);
  let max: string | undefined;
  for (const sibling of siblings) {
    if (sibling.orderKey && (!max || sibling.orderKey > max)) max = sibling.orderKey;
  }
  return generateKeyBetween(max ?? null, null);
}

// --- Entries ---

export async function createEntry(input: EntryCreateInput): Promise<EntryDto> {
  const id = input.id ?? newObjectId();
  const createdAt = input.createdAt ?? nowIso();
  // Auto-said: a direct mention means the person heard it, unless the client says otherwise.
  const saidToIds = input.saidTo === undefined ? input.people : saidToIdList(input.saidTo);
  // New entries default to the bottom of their sibling list.
  const orderKey = input.orderKey ?? (await bottomOrderKey(input.parentId ?? null, input.dateKey));

  const entry: LocalEntry = {
    id,
    content: input.content,
    dateKey: input.dateKey,
    importance: input.importance,
    tagIds: input.tags,
    peopleIds: input.people,
    threadIds: input.threads,
    saidTo: saidToIds.map((personId) => ({ personId, at: createdAt })),
    hiddenFor: [],
    parentId: input.parentId ?? null,
    orderKey,
    createdAt,
    updatedAt: createdAt,
  };
  await db.entries.add(entry);
  await bumpLastCheckup(saidToIds, createdAt);
  await enqueue('POST', '/entries', { ...input, id, createdAt, orderKey });
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
    const ids = saidToIdList(input.saidTo);
    const existingAt = new Map(entry.saidTo.map((s) => [s.personId, s.at]));
    newlySaid = ids.filter((id) => !existingAt.has(id));
    saidTo = ids.map((personId): SaidMark => ({ personId, at: existingAt.get(personId) ?? now }));
  }

  // A date edit moves the entry to a different day's sibling list — send it to the bottom there,
  // same as a brand-new entry. (Only root entries can have their date edited today, since
  // EntryComposer only shows the date field for entry.parentId === null, but this doesn't need
  // to assume that.)
  const dateChanging = input.dateKey !== undefined && input.dateKey !== entry.dateKey;
  const orderKey = dateChanging ? await bottomOrderKey(entry.parentId, input.dateKey!) : entry.orderKey;

  const updated: LocalEntry = {
    ...entry,
    content: input.content ?? entry.content,
    dateKey: input.dateKey ?? entry.dateKey,
    importance: input.importance ?? entry.importance,
    tagIds: input.tags ?? entry.tagIds,
    threadIds: input.threads ?? entry.threadIds ?? [],
    // Editing mentions intentionally does NOT touch saidTo (independently editable).
    peopleIds: input.people ?? entry.peopleIds,
    saidTo,
    hiddenFor: input.hiddenFor ?? entry.hiddenFor,
    orderKey,
    updatedAt: now,
  };
  await db.entries.put(updated);
  if (dateChanging) {
    await cascadeDateKey(entryId, input.dateKey!, now);
  }
  await bumpLastCheckup(newlySaid, now);
  await enqueue('PATCH', `/entries/${entryId}`, dateChanging ? { ...input, orderKey } : input);
  return entryDto(entryId, updated.dateKey);
}

/** Reparent and/or reorder an entry via drag-and-drop within the same day's tree. `newOrderKey`
    is the caller's already-projected sibling position (see web/src/lib/sortableTree.ts) — this
    only re-derives the tree shape to re-validate depth/cycles as defense-in-depth, mirroring the
    server's authoritative check in entryService.updateEntry; the drag UI already blocks invalid
    projections visually, so these guards should never actually fire in practice. */
export async function moveEntry(
  entryId: string,
  newParentId: string | null,
  newOrderKey: string,
): Promise<EntryDto> {
  const entry = await db.entries.get(entryId);
  if (!entry) throw new ApiError(404, 'entry.not_found');

  if (newParentId !== entry.parentId) {
    const rows = await db.entries.where('dateKey').equals(entry.dateKey).toArray();
    const parentById = new Map(rows.map((r): [string, string | null] => [r.id, r.parentId]));
    if (newParentId !== null && isSelfOrDescendant(newParentId, entryId, parentById)) {
      throw new ApiError(400, 'entry.cycle');
    }
    const depthOf = (id: string | null): number => {
      let depth = -1;
      for (let current = id; current !== null; current = parentById.get(current) ?? null) depth += 1;
      return depth;
    };
    const childrenByParent = new Map<string | null, string[]>();
    for (const row of rows) childrenByParent.set(row.parentId, [...(childrenByParent.get(row.parentId) ?? []), row.id]);
    const heightOf = (id: string): number => {
      const kids = childrenByParent.get(id) ?? [];
      return kids.length === 0 ? 1 : 1 + Math.max(...kids.map(heightOf));
    };
    const { maxSubEntryDepth } = await getSettings();
    if (wouldExceedMaxDepth(depthOf(newParentId), heightOf(entryId), maxSubEntryDepth)) {
      throw new ApiError(400, 'entry.max_depth');
    }
  }

  const now = nowIso();
  await db.entries.update(entryId, { parentId: newParentId, orderKey: newOrderKey, updatedAt: now });
  await enqueue('PATCH', `/entries/${entryId}`, { parentId: newParentId, orderKey: newOrderKey });
  return entryDto(entryId, entry.dateKey);
}

/**
 * Delete an entry and all of its descendants (the server cascades the same way).
 *
 * Returns the rows it removed, parents first, so `restoreEntries` can put the whole subtree back.
 * Collecting them costs nothing: the cascade already has to read every descendant to know what
 * to delete, so the snapshot is the same query with its result kept instead of discarded.
 */
export async function deleteEntry(entryId: string): Promise<EntryDeletion> {
  const root = await db.entries.get(entryId);
  const removed: LocalEntry[] = root ? [root] : [];
  let frontier = [entryId];
  while (frontier.length) {
    const children = await db.entries.where('parentId').anyOf(frontier).toArray();
    frontier = children.map((c) => c.id);
    removed.push(...children);
  }
  await db.entries.bulkDelete(removed.map((e) => e.id));
  await enqueue('DELETE', `/entries/${entryId}`);
  return { kind: 'entry', entries: removed };
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

/**
 * Mark (or unmark) a whole set of entries as said to one person in a single action — what the
 * profile's per-thread "mark all" button does.
 *
 * The caller passes the exact ids, taken from the TalkingPointGroup it rendered, rather than
 * having this re-derive them: that way the count on the button and the set that gets written are
 * provably the same, and nothing can be marked that the user never had on screen.
 *
 * There is deliberately no bulk endpoint. This queues the ordinary per-entry ops, which keeps
 * replay idempotent and — important — keeps the outbox path shape at `entries/<id>/said/<person>`,
 * which sync.ts's dirtyIds() parses positionally to protect unpushed edits from being clobbered.
 */
export async function setSaidBulk(
  entryIds: string[],
  personId: string,
  said: boolean,
): Promise<void> {
  if (!entryIds.length) return;
  const now = nowIso();
  await db.entries
    .where('id')
    .anyOf(entryIds)
    .modify((entry) => {
      entry.saidTo = entry.saidTo.filter((s) => s.personId !== personId);
      if (said) entry.saidTo.push({ personId, at: now });
      entry.updatedAt = now;
    });
  // One bump, not one per entry — it only ever moves lastCheckupAt forward anyway.
  if (said) await bumpLastCheckup([personId], now);
  await enqueueBatch(
    entryIds.map(
      (entryId): OutboxOp => ({
        method: said ? 'PUT' : 'DELETE',
        path: `/entries/${entryId}/said/${personId}`,
      }),
    ),
  );
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
    events: input.events ?? [],
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
      if (input.events !== undefined) p.events = input.events;
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

export async function deletePerson(personId: string): Promise<PersonDeletion> {
  const person = await requireLocalPerson(personId);
  // Read the entries the cascade is about to rewrite *before* rewriting them: the mention,
  // said and hidden marks it strips are not recoverable from the person row alone.
  const touched = await db.entries
    .filter(
      (e) =>
        e.peopleIds.includes(personId) ||
        e.hiddenFor.includes(personId) ||
        e.saidTo.some((s) => s.personId === personId),
    )
    .toArray();
  const links: EntryPersonLink[] = touched.map((e) => ({
    entryId: e.id,
    peopleIds: e.peopleIds,
    hiddenFor: e.hiddenFor,
    saidTo: e.saidTo,
  }));

  await db.people.delete(personId);
  // Mirror the server cascade: pull the person out of every entry.
  await db.entries
    .where('id')
    .anyOf(touched.map((e) => e.id))
    .modify((e) => {
      e.peopleIds = e.peopleIds.filter((id) => id !== personId);
      e.hiddenFor = e.hiddenFor.filter((id) => id !== personId);
      e.saidTo = e.saidTo.filter((s) => s.personId !== personId);
    });
  await enqueue('DELETE', `/people/${personId}`);
  return { kind: 'person', person, links };
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
      events: [],
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

// --- Person events ---

async function requireLocalPerson(personId: string): Promise<LocalPerson> {
  const person = await db.people.get(personId);
  if (!person) throw new ApiError(404, 'person.not_found');
  return person;
}

/** Add a new event, or replace the existing one with the same id. */
export async function saveEvent(personId: string, event: PersonEventInput): Promise<PersonDto> {
  const person = await requireLocalPerson(personId);
  const existing = person.events ?? [];
  const events = existing.some((e) => e.id === event.id)
    ? existing.map((e) => (e.id === event.id ? { ...e, ...event } : e))
    : [...existing, event];
  // Rides the ordinary person PATCH — the events array is just another field on the person.
  return updatePerson(personId, { events });
}

export async function deleteEvent(personId: string, eventId: string): Promise<EventDeletion> {
  const local = await requireLocalPerson(personId);
  const removed = (local.events ?? []).find((event) => event.id === eventId);
  if (!removed) throw new ApiError(404, 'person.not_found');
  const events = (local.events ?? []).filter((event) => event.id !== eventId);
  const person = await updatePerson(personId, { events });
  return { kind: 'event', personId, event: removed, person };
}

/**
 * Clear an event's follow-up. Unlike saving an event this is NOT a plain field patch: asking
 * someone how their trip went is an interaction, so it also bumps lastCheckupAt. The server route
 * applies the identical rule, which is what keeps the two sides converged after a replay.
 */
export async function markEventAsked(personId: string, eventId: string): Promise<PersonDto> {
  const person = await requireLocalPerson(personId);
  if (!(person.events ?? []).some((event) => event.id === eventId)) {
    throw new ApiError(404, 'person.not_found');
  }
  const now = nowIso();
  await db.people
    .where('id')
    .equals(personId)
    .modify((p) => {
      p.events = (p.events ?? []).map((event) =>
        event.id === eventId ? { ...event, askedAt: now } : event,
      );
    });
  await bumpLastCheckup([personId], now);
  await enqueue('PUT', `/people/${personId}/events/${eventId}/asked`);
  return getPerson(personId);
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

export async function deleteTag(tagId: string): Promise<TagDeletion> {
  const tag = await db.tags.get(tagId);
  if (!tag) throw new ApiError(404, 'tag.not_found');
  // Which entries and people carried the tag is the only part of a tag deletion that isn't
  // reconstructible afterwards, so it is captured before the cascade runs.
  const entryIds = (await db.entries.where('tagIds').equals(tagId).toArray()).map((e) => e.id);
  const peopleIds = (await db.people.toArray())
    .filter((p) => p.tagIds.includes(tagId))
    .map((p) => p.id);

  await db.tags.delete(tagId);
  await db.entries
    .where('id')
    .anyOf(entryIds)
    .modify((e) => {
      e.tagIds = e.tagIds.filter((id) => id !== tagId);
    });
  await db.people
    .where('id')
    .anyOf(peopleIds)
    .modify((p) => {
      p.tagIds = p.tagIds.filter((id) => id !== tagId);
    });
  await enqueue('DELETE', `/tags/${tagId}`);
  return { kind: 'tag', tag, entryIds, peopleIds };
}

// --- Threads ---

async function assertUniqueThreadName(name: string, exceptId?: string): Promise<void> {
  const clash = (await db.threads.toArray()).find(
    (t) => t.id !== exceptId && fuzzyEquals(t.name, name),
  );
  if (clash) throw new ApiError(409, 'thread.duplicate_name');
}

export async function createThread(input: ThreadCreateInput): Promise<ThreadDto> {
  await assertUniqueThreadName(input.name);
  const id = input.id ?? newObjectId();
  const createdAt = input.createdAt ?? nowIso();
  const thread: ThreadDto = { id, name: input.name, createdAt, updatedAt: createdAt };
  await db.threads.add(thread);
  await enqueue('POST', '/threads', { ...input, id, createdAt });
  return thread;
}

export async function updateThread(threadId: string, input: ThreadUpdateInput): Promise<ThreadDto> {
  if (input.name !== undefined) await assertUniqueThreadName(input.name, threadId);
  const now = nowIso();
  const count = await db.threads
    .where('id')
    .equals(threadId)
    .modify((t) => {
      if (input.name !== undefined) t.name = input.name;
      t.updatedAt = now;
    });
  if (!count) throw new ApiError(404, 'thread.not_found');
  // No mention-text rewrite to do, unlike renameTagMentions: a thread is never typed into an
  // entry's content, so the structured link is the only place its name appears.
  await enqueue('PATCH', `/threads/${threadId}`, input);
  return (await db.threads.get(threadId))!;
}

/** Deleting a thread only ungroups its entries. Every saidTo mark a "mark all" ever wrote lives on
    the entries themselves and is untouched, so the history stays accurate. */
export async function deleteThread(threadId: string): Promise<ThreadDeletion> {
  const thread = await db.threads.get(threadId);
  if (!thread) throw new ApiError(404, 'thread.not_found');
  const entryIds = (await db.entries.where('threadIds').equals(threadId).toArray()).map((e) => e.id);

  await db.threads.delete(threadId);
  const now = nowIso();
  await db.entries
    .where('id')
    .anyOf(entryIds)
    .modify((e) => {
      e.threadIds = e.threadIds.filter((id) => id !== threadId);
      e.updatedAt = now;
    });
  await enqueue('DELETE', `/threads/${threadId}`);
  return { kind: 'thread', thread, entryIds };
}

/** Add or remove one entry's membership of one thread — the "Add to thread…" menu action, which is
    how an ongoing topic usually gets assembled: after the fact, from entries already written. */
export async function setEntryThreads(entryId: string, threadIds: string[]): Promise<EntryDto> {
  const entry = await db.entries.get(entryId);
  if (!entry) throw new ApiError(404, 'entry.not_found');
  const now = nowIso();
  await db.entries.update(entryId, { threadIds, updatedAt: now });
  await enqueue('PATCH', `/entries/${entryId}`, { threads: threadIds });
  return entryDto(entryId, entry.dateKey);
}

// --- Restoring a deletion (undo) ---

/** The create body for one entry, shaped for `POST /entries`. Shared with importEntries' idea of
    a round-trip: everything except `hiddenFor`, which isn't part of entryCreateSchema. */
const entryCreateBody = (entry: LocalEntry) => ({
  id: entry.id,
  createdAt: entry.createdAt,
  content: entry.content,
  dateKey: entry.dateKey,
  importance: entry.importance,
  tags: entry.tagIds,
  people: entry.peopleIds,
  threads: entry.threadIds,
  saidTo: entry.saidTo,
  parentId: entry.parentId,
  orderKey: entry.orderKey,
});

/**
 * Put back an entry subtree removed by `deleteEntry`.
 *
 * The rows go back in parent-first order — the same order the cascade collected them — because
 * the server validates a create's depth against its parent, which therefore has to exist first.
 */
export async function restoreEntries(deletion: EntryDeletion): Promise<void> {
  const { entries } = deletion;
  if (!entries.length) return;
  await db.entries.bulkPut(entries);
  await enqueueBatch(
    entries.flatMap((entry): OutboxOp[] => [
      { method: 'POST', path: '/entries', body: entryCreateBody(entry) },
      // hiddenFor rides its own call per person, exactly as it does in importEntries.
      ...entry.hiddenFor.map(
        (personId): OutboxOp => ({ method: 'PUT', path: `/entries/${entry.id}/hidden/${personId}` }),
      ),
    ]),
  );
}

/** Put back a deleted person, along with every mention, said mark and hidden mark that named them. */
export async function restorePerson(deletion: PersonDeletion): Promise<void> {
  const { person, links } = deletion;
  await db.people.put(person);

  const byId = new Map(links.map((link) => [link.entryId, link]));
  // Only entries that still exist: one may have been deleted while the toast was up, and putting
  // a bare link row back would resurrect it as a half-formed entry.
  const present = await db.entries.where('id').anyOf([...byId.keys()]).toArray();
  await db.entries.bulkPut(
    present.map((entry) => {
      const link = byId.get(entry.id)!;
      return { ...entry, peopleIds: link.peopleIds, hiddenFor: link.hiddenFor, saidTo: link.saidTo };
    }),
  );

  await enqueueBatch([
    {
      method: 'POST',
      path: '/people',
      body: {
        id: person.id,
        createdAt: person.createdAt,
        name: person.name,
        aliases: person.aliases,
        phone: person.phone,
        email: person.email,
        wechatId: person.wechatId,
        birthday: person.birthday,
        company: person.company,
        jobTitle: person.jobTitle,
        contactId: person.contactId,
        events: person.events,
        tags: person.tagIds,
        notes: person.notes,
        checkupIntervalDays: person.checkupIntervalDays,
      },
    },
    ...present.map((entry): OutboxOp => {
      const link = byId.get(entry.id)!;
      return {
        method: 'PATCH',
        path: `/entries/${entry.id}`,
        body: { people: link.peopleIds, saidTo: link.saidTo, hiddenFor: link.hiddenFor },
      };
    }),
  ]);
}

/** Put back a deleted tag and re-attach it to the entries and people that carried it. */
export async function restoreTag(deletion: TagDeletion): Promise<void> {
  const { tag, entryIds, peopleIds } = deletion;
  await db.tags.put(tag);
  const readdTag = (row: { tagIds: string[] }) => {
    if (!row.tagIds.includes(tag.id)) row.tagIds = [...row.tagIds, tag.id];
  };
  await db.entries.where('id').anyOf(entryIds).modify(readdTag);
  await db.people.where('id').anyOf(peopleIds).modify(readdTag);

  // Re-read rather than trusting the snapshot's tag lists: the entry may have gained or lost
  // other tags while the toast was up, and the PATCH replaces the whole array.
  const [entries, people] = await Promise.all([
    db.entries.where('id').anyOf(entryIds).toArray(),
    db.people.where('id').anyOf(peopleIds).toArray(),
  ]);
  await enqueueBatch([
    { method: 'POST', path: '/tags', body: { id: tag.id, name: tag.name, color: tag.color } },
    ...entries.map((e): OutboxOp => ({ method: 'PATCH', path: `/entries/${e.id}`, body: { tags: e.tagIds } })),
    ...people.map((p): OutboxOp => ({ method: 'PATCH', path: `/people/${p.id}`, body: { tags: p.tagIds } })),
  ]);
}

/** Put back a deleted thread and re-group the entries it held. */
export async function restoreThread(deletion: ThreadDeletion): Promise<void> {
  const { thread, entryIds } = deletion;
  await db.threads.put(thread);
  const now = nowIso();
  await db.entries
    .where('id')
    .anyOf(entryIds)
    .modify((e) => {
      if (!e.threadIds.includes(thread.id)) e.threadIds = [...e.threadIds, thread.id];
      e.updatedAt = now;
    });

  const entries = await db.entries.where('id').anyOf(entryIds).toArray();
  await enqueueBatch([
    {
      method: 'POST',
      path: '/threads',
      body: { id: thread.id, name: thread.name, createdAt: thread.createdAt },
    },
    ...entries.map(
      (e): OutboxOp => ({ method: 'PATCH', path: `/entries/${e.id}`, body: { threads: e.threadIds } }),
    ),
  ]);
}

/** Put back a deleted person event. Just a save — the event carries its own id. */
export async function restoreEvent(deletion: EventDeletion): Promise<PersonDto> {
  return saveEvent(deletion.personId, deletion.event);
}

// --- Settings ---

export async function saveSettings(input: SettingsInput): Promise<SettingsDto> {
  // Merge over the current settings (not just DEFAULT_SETTINGS) so fields the caller didn't
  // touch survive instead of being blanked.
  const current = await getSettings();
  /* Provider keys are write-only: they ride the outbox payload up but must never be written into
     the local mirror, or making a key "server-only" would have achieved nothing — it would just
     be stored in IndexedDB by a different route. Only the has*Key flags are mirrored, derived
     from whatever was sent, so the UI reflects the change without waiting for a sync. */
  const { groqApiKey, openRouterApiKey, cerebrasApiKey, ...rest } = input;
  const settings: SettingsDto = {
    ...current,
    ...rest,
    ...(groqApiKey !== undefined ? { hasGroqKey: groqApiKey !== '' } : {}),
    ...(openRouterApiKey !== undefined ? { hasOpenRouterKey: openRouterApiKey !== '' } : {}),
    ...(cerebrasApiKey !== undefined ? { hasCerebrasKey: cerebrasApiKey !== '' } : {}),
  };
  await db.meta.put({ key: 'settings', value: settings });
  await enqueue('PUT', '/settings', input);
  return settings;
}

// --- Backup import ---

/* Restoring a JSON backup. Unlike importPeople (contacts, keyed by contactId), a backup row is
   keyed by its own id, and there are three entity kinds instead of one — so this writes tags,
   then people, then entries, threading an id map forward at each step (an imported row's id
   survives a clean create, but a "keep both" or "merge" changes what id downstream references
   must point at). Each import* function does its own Dexie write and returns its outbox ops
   without enqueueing them; importBackup enqueues everything once at the end, mirroring
   enqueueBatch's own reasoning for importPeople (don't reconcile notifications once per row). */

export interface TagImportItem {
  row: TagBackupRow;
  resolution: BackupResolution;
}

export async function importTags(
  items: TagImportItem[],
): Promise<{ created: number; merged: number; tagIdMap: Map<string, string>; ops: OutboxOp[] }> {
  const tagIdMap = new Map<string, string>();
  const creates: TagDto[] = [];
  const ops: OutboxOp[] = [];
  let merged = 0;

  for (const { row, resolution } of items) {
    switch (resolution.action) {
      case 'overwrite':
        throw new Error('tags do not support the overwrite resolution');
      case 'merge':
        // Covers both "already exists, use it as-is" (targetId === row.id) and "fold into the
        // existing tag with a clashing name" — neither writes anything, they just redirect
        // whatever downstream people/entries referenced this row's id.
        tagIdMap.set(row.id, resolution.targetId);
        merged++;
        continue;
      case 'create':
        // A name clash blocks 'create' at review time (see isTagHardConflict), so by the time
        // this runs `row.name` has already been edited to something free, if it needed to be.
        tagIdMap.set(row.id, row.id);
        creates.push({ id: row.id, name: row.name, color: row.color });
        ops.push({ method: 'POST', path: '/tags', body: { id: row.id, name: row.name, color: row.color } });
        continue;
    }
  }

  if (creates.length) await db.tags.bulkAdd(creates);
  return { created: creates.length, merged, tagIdMap, ops };
}

export interface ThreadImportItem {
  row: ThreadBackupRow;
  resolution: BackupResolution;
}

/** Threads import exactly like tags — same two resolutions, same id-map-forward contract. */
export async function importThreads(
  items: ThreadImportItem[],
): Promise<{ created: number; merged: number; threadIdMap: Map<string, string>; ops: OutboxOp[] }> {
  const threadIdMap = new Map<string, string>();
  const creates: ThreadDto[] = [];
  const ops: OutboxOp[] = [];
  let merged = 0;

  for (const { row, resolution } of items) {
    switch (resolution.action) {
      case 'overwrite':
        throw new Error('threads do not support the overwrite resolution');
      case 'merge':
        threadIdMap.set(row.id, resolution.targetId);
        merged++;
        continue;
      case 'create':
        threadIdMap.set(row.id, row.id);
        creates.push(row);
        ops.push({
          method: 'POST',
          path: '/threads',
          body: { id: row.id, name: row.name, createdAt: row.createdAt },
        });
        continue;
    }
  }

  if (creates.length) await db.threads.bulkAdd(creates);
  return { created: creates.length, merged, threadIdMap, ops };
}

export interface PersonImportItem {
  row: PersonBackupRow;
  resolution: BackupResolution;
}

/** Fields a merge may fill in from a backup row, plus tags/events it may add. Only ever fills
    blanks or adds — same rule as mergePatch (contacts import) — an import must never overwrite
    something the user already has recorded locally. */
function mergeBackupPersonPatch(
  target: LocalPerson,
  incoming: PersonBackupRow,
  tagIdMap: Map<string, string>,
): PersonUpdateInput | null {
  const patch: PersonUpdateInput = {};
  if (!target.phone && incoming.phone) patch.phone = incoming.phone;
  if (!target.email && incoming.email) patch.email = incoming.email;
  if (!target.wechatId && incoming.wechatId) patch.wechatId = incoming.wechatId;
  if (!target.birthday && incoming.birthday) patch.birthday = incoming.birthday;
  if (!target.company && incoming.company) patch.company = incoming.company;
  if (!target.jobTitle && incoming.jobTitle) patch.jobTitle = incoming.jobTitle;
  if (!target.contactId && incoming.contactId) patch.contactId = incoming.contactId;
  if (!target.notes && incoming.notes) patch.notes = incoming.notes;
  if (target.checkupIntervalDays === null && incoming.checkupIntervalDays !== null) {
    patch.checkupIntervalDays = incoming.checkupIntervalDays;
  }

  const existingAliases = target.aliases ?? [];
  const mergedAliases = [...existingAliases];
  for (const alias of incoming.aliases) {
    if (fuzzyEquals(alias, target.name)) continue;
    if (mergedAliases.some((known) => fuzzyEquals(known, alias))) continue;
    mergedAliases.push(alias);
  }
  if (mergedAliases.length !== existingAliases.length) patch.aliases = mergedAliases.slice(0, MAX_ALIASES);

  const mappedTagIds = incoming.tagIds.flatMap((id) => {
    const mapped = tagIdMap.get(id);
    return mapped ? [mapped] : [];
  });
  const unionTagIds = [...new Set([...target.tagIds, ...mappedTagIds])];
  if (unionTagIds.length !== target.tagIds.length) patch.tags = unionTagIds;

  const existingEventIds = new Set(target.events.map((e) => e.id));
  const newEvents = incoming.events.filter((e) => !existingEventIds.has(e.id));
  if (newEvents.length) patch.events = [...target.events, ...newEvents];

  return Object.keys(patch).length ? patch : null;
}

export async function importPeopleFromBackup(
  items: PersonImportItem[],
  tagIdMap: Map<string, string>,
): Promise<{ created: number; merged: number; personIdMap: Map<string, string>; ops: OutboxOp[] }> {
  const byId = new Map((await db.people.toArray()).map((person) => [person.id, person]));
  const personIdMap = new Map<string, string>();
  const creates: LocalPerson[] = [];
  const updates: LocalPerson[] = [];
  const ops: OutboxOp[] = [];
  let merged = 0;

  for (const { row, resolution } of items) {
    switch (resolution.action) {
      case 'overwrite':
        throw new Error('people do not support the overwrite resolution');
      case 'merge': {
        const target = byId.get(resolution.targetId);
        if (!target) continue; // deleted underneath us; nothing sensible to merge into
        personIdMap.set(row.id, target.id);
        const patch = mergeBackupPersonPatch(target, row, tagIdMap);
        if (!patch) continue; // the person already knows everything this row could tell us
        const updated: LocalPerson = {
          ...target,
          aliases: patch.aliases ?? target.aliases,
          phone: patch.phone ?? target.phone,
          email: patch.email ?? target.email,
          wechatId: patch.wechatId ?? target.wechatId,
          birthday: patch.birthday ?? target.birthday,
          company: patch.company ?? target.company,
          jobTitle: patch.jobTitle ?? target.jobTitle,
          contactId: patch.contactId ?? target.contactId,
          notes: patch.notes ?? target.notes,
          tagIds: patch.tags ?? target.tagIds,
          events: patch.events ?? target.events,
          checkupIntervalDays: patch.checkupIntervalDays ?? target.checkupIntervalDays,
        };
        updates.push(updated);
        byId.set(target.id, updated); // keeps a second row merging into the same target consistent
        merged++;
        ops.push({ method: 'PATCH', path: `/people/${target.id}`, body: patch });
        continue;
      }
      case 'create': {
        const mappedTagIds = row.tagIds.flatMap((id) => {
          const mapped = tagIdMap.get(id);
          return mapped ? [mapped] : [];
        });
        const person: LocalPerson = {
          id: row.id,
          name: row.name,
          aliases: row.aliases,
          phone: row.phone,
          email: row.email,
          wechatId: row.wechatId,
          birthday: row.birthday,
          company: row.company,
          jobTitle: row.jobTitle,
          contactId: row.contactId,
          events: row.events,
          tagIds: mappedTagIds,
          notes: row.notes,
          checkupIntervalDays: row.checkupIntervalDays,
          lastCheckupAt: row.lastCheckupAt,
          createdAt: row.createdAt,
        };
        creates.push(person);
        personIdMap.set(row.id, row.id);
        ops.push({
          method: 'POST',
          path: '/people',
          body: {
            id: person.id,
            createdAt: person.createdAt,
            name: person.name,
            aliases: person.aliases,
            phone: person.phone,
            email: person.email,
            wechatId: person.wechatId,
            birthday: person.birthday,
            company: person.company,
            jobTitle: person.jobTitle,
            contactId: person.contactId,
            events: person.events,
            tags: mappedTagIds,
            notes: person.notes,
            checkupIntervalDays: person.checkupIntervalDays,
          },
        });
        continue;
      }
    }
  }

  await db.transaction('rw', db.people, async () => {
    if (creates.length) await db.people.bulkAdd(creates);
    if (updates.length) await db.people.bulkPut(updates);
  });

  return { created: creates.length, merged, personIdMap, ops };
}

export interface EntryImportItem {
  row: EntryBackupRow;
  resolution: BackupResolution;
}

export async function importEntries(
  items: EntryImportItem[],
  tagIdMap: Map<string, string>,
  personIdMap: Map<string, string>,
  threadIdMap: Map<string, string>,
): Promise<{ created: number; merged: number; orphaned: number; ops: OutboxOp[] }> {
  const existingIds = new Set((await db.entries.toArray()).map((e) => e.id));
  const remapIds = (ids: string[], map: Map<string, string>) =>
    ids.flatMap((id) => {
      const mapped = map.get(id);
      return mapped ? [mapped] : [];
    });

  // Pass 1: decide every surviving row's final id first — a child can appear before its parent
  // in file order, so the full id map must exist before pass 2 rewrites any parentId.
  const entryIdMap = new Map<string, string>();
  const prepared: { row: EntryBackupRow; finalId: string; isOverwrite: boolean }[] = [];

  for (const { row, resolution } of items) {
    if (resolution.action === 'merge') throw new Error('entries do not support the merge resolution');
    const isOverwrite = resolution.action === 'overwrite';
    const finalId = isOverwrite ? row.id : newObjectId();
    entryIdMap.set(row.id, finalId);
    prepared.push({ row, finalId, isOverwrite });
  }

  // Pass 2: rewrite every reference (tags/people/saidTo/hiddenFor/parentId) through the maps
  // built above. A parent that was never part of this import and isn't already local either
  // gets promoted to root rather than left dangling.
  let orphaned = 0;
  const creates: LocalEntry[] = [];
  const overwrites: LocalEntry[] = [];
  const ops: OutboxOp[] = [];

  for (const { row, finalId, isOverwrite } of prepared) {
    let parentId: string | null = null;
    if (row.parentId !== null) {
      const mappedParent = entryIdMap.get(row.parentId);
      if (mappedParent) parentId = mappedParent;
      else if (existingIds.has(row.parentId)) parentId = row.parentId;
      else orphaned++;
    }

    const tagIds = remapIds(row.tagIds, tagIdMap);
    const peopleIds = remapIds(row.peopleIds, personIdMap);
    const threadIds = remapIds(row.threadIds, threadIdMap);
    const hiddenFor = remapIds(row.hiddenFor, personIdMap);
    const saidTo: SaidMark[] = row.saidTo.flatMap((s) => {
      const personId = personIdMap.get(s.personId);
      return personId ? [{ personId, at: s.at }] : [];
    });

    const entry: LocalEntry = {
      id: finalId,
      content: row.content,
      dateKey: row.dateKey,
      importance: row.importance,
      tagIds,
      peopleIds,
      threadIds,
      saidTo,
      hiddenFor,
      parentId,
      orderKey: row.orderKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    if (isOverwrite) overwrites.push(entry);
    else creates.push(entry);

    if (isOverwrite) {
      ops.push({
        method: 'PATCH',
        path: `/entries/${entry.id}`,
        body: {
          content: entry.content,
          dateKey: entry.dateKey,
          importance: entry.importance,
          tags: tagIds,
          people: peopleIds,
          threads: threadIds,
          saidTo,
          hiddenFor,
          parentId: entry.parentId,
          orderKey: entry.orderKey,
        },
      });
    } else {
      ops.push({
        method: 'POST',
        path: '/entries',
        body: {
          id: entry.id,
          createdAt: entry.createdAt,
          content: entry.content,
          dateKey: entry.dateKey,
          importance: entry.importance,
          tags: tagIds,
          people: peopleIds,
          threads: threadIds,
          saidTo,
          parentId: entry.parentId,
          orderKey: entry.orderKey,
        },
      });
      // hiddenFor isn't part of entryCreateSchema, so it rides one follow-up call per person.
      for (const personId of hiddenFor) {
        ops.push({ method: 'PUT', path: `/entries/${entry.id}/hidden/${personId}` });
      }
    }
  }

  await db.transaction('rw', db.entries, async () => {
    if (creates.length) await db.entries.bulkAdd(creates);
    if (overwrites.length) await db.entries.bulkPut(overwrites);
  });

  return { created: creates.length, merged: overwrites.length, orphaned, ops };
}

export interface BackupImportPlan {
  tags: TagImportItem[];
  threads: ThreadImportItem[];
  people: PersonImportItem[];
  entries: EntryImportItem[];
}

export interface BackupImportSummary {
  tags: { created: number; merged: number };
  threads: { created: number; merged: number };
  people: { created: number; merged: number };
  entries: { created: number; merged: number; orphaned: number };
}

/** Applies a fully-resolved backup import plan: tags and threads first, then people (their tagIds
    rewritten through the fresh tagIdMap), then entries (rewritten through all three maps) — each
    step needs the id map(s) the previous one produced. Threads only have to precede entries, since
    nothing but an entry references one. One shared enqueueBatch at the end, not one per step. */
export async function importBackup(plan: BackupImportPlan): Promise<BackupImportSummary> {
  const tagsResult = await importTags(plan.tags);
  const threadsResult = await importThreads(plan.threads);
  const peopleResult = await importPeopleFromBackup(plan.people, tagsResult.tagIdMap);
  const entriesResult = await importEntries(
    plan.entries,
    tagsResult.tagIdMap,
    peopleResult.personIdMap,
    threadsResult.threadIdMap,
  );

  await enqueueBatch([
    ...tagsResult.ops,
    ...threadsResult.ops,
    ...peopleResult.ops,
    ...entriesResult.ops,
  ]);

  return {
    tags: { created: tagsResult.created, merged: tagsResult.merged },
    threads: { created: threadsResult.created, merged: threadsResult.merged },
    people: { created: peopleResult.created, merged: peopleResult.merged },
    entries: {
      created: entriesResult.created,
      merged: entriesResult.merged,
      orphaned: entriesResult.orphaned,
    },
  };
}
