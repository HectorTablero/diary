import type { EntryDto, PersonDto, PersonEventDto, SaidMark, TagDto } from '@diary/shared';
import { normalizeBirthday } from '@diary/shared';
import Dexie, { type EntityTable } from 'dexie';

/* Local-first store: the source of truth the UI reads from. Entries and people
   are stored normalized (ids only) and joined with tags/people at read time, so
   structured links never go stale on rename. The literal @Name/#Tag text inside
   entry.content is a separate, denormalized copy (typed by the composer) that
   mutations.ts's rename helpers must rewrite explicitly when a name changes. */

export interface LocalEntry {
  id: string;
  content: string;
  dateKey: string;
  importance: number;
  tagIds: string[];
  peopleIds: string[];
  saidTo: SaidMark[];
  hiddenFor: string[];
  parentId: string | null;
  /** Fractional-index sibling sort key. Optional (not `string`) because rows written before
      drag-and-drop reorder existed genuinely lack it — see the note above db.version(3). */
  orderKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalPerson {
  id: string;
  name: string;
  aliases: string[];
  phone: string | null;
  email: string | null;
  wechatId: string | null;
  birthday: string | null;
  company: string | null;
  jobTitle: string | null;
  contactId: string | null;
  events: PersonEventDto[];
  tagIds: string[];
  notes: string;
  checkupIntervalDays: number | null;
  lastCheckupAt: string;
  createdAt: string;
}

/** A queued mutation, replayed against the REST API in order once online. */
export interface OutboxOp {
  seq?: number;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

interface MetaRow {
  key: string;
  value: unknown;
}

export const db = new Dexie('diary') as Dexie & {
  entries: EntityTable<LocalEntry, 'id'>;
  people: EntityTable<LocalPerson, 'id'>;
  tags: EntityTable<TagDto, 'id'>;
  outbox: EntityTable<OutboxOp, 'seq'>;
  meta: EntityTable<MetaRow, 'key'>;
};

db.version(1).stores({
  entries: 'id, dateKey, parentId, *tagIds, *peopleIds',
  people: 'id, name',
  tags: 'id, name',
  outbox: '++seq',
  meta: 'key',
});

/* v2 adds contact metadata. The upgrade backfills defaults because a cursor-based pull() only
   re-sends people the server considers changed — untouched rows would otherwise keep `undefined`
   for every new field and quietly break `person.aliases.map(...)` style reads. */
db.version(2)
  .stores({
    entries: 'id, dateKey, parentId, *tagIds, *peopleIds',
    people: 'id, name, *aliases, contactId',
    tags: 'id, name',
    outbox: '++seq',
    meta: 'key',
  })
  .upgrade((tx) =>
    tx
      .table<LocalPerson>('people')
      .toCollection()
      .modify((person) => {
        person.aliases ??= [];
        person.phone ??= null;
        person.email ??= null;
        person.wechatId ??= null;
        person.birthday ??= null;
        person.company ??= null;
        person.jobTitle ??= null;
        person.contactId ??= null;
      }),
  );

/* v3 adds person events. It also settles the debt the v2 block left behind: an early build wrote
   year-less birthdays as `---10-10` (three dashes) instead of `--10-10`, and the marker parked here
   asked whoever bumped the version next to migrate them. Doing it now means `normalizeBirthday`
   only has to survive as a read-side shim for rows this upgrade hasn't reached yet (a client that
   hasn't opened the app since), not forever. */
/* --- orderKey: no dedicated Dexie upgrade -----------------------------------------------------
   Unlike the fields above, LocalEntry.orderKey has no `.upgrade()` here: it's populated lazily
   on read instead, via ensureOrderKeys() in db/repo.ts (called from getDayEntries), following
   the same "read heals the row" idea as normalizeBirthday above. Next time this version is
   bumped for any other reason, add an `.upgrade()` that fills in any still-missing orderKeys via
   generateNKeysBetween, then delete ensureOrderKeys and its call site, and make
   LocalEntry.orderKey (and EntryDto.orderKey) required again. */

db.version(3)
  .stores({
    entries: 'id, dateKey, parentId, *tagIds, *peopleIds',
    people: 'id, name, *aliases, contactId',
    tags: 'id, name',
    outbox: '++seq',
    meta: 'key',
  })
  .upgrade((tx) =>
    tx
      .table<LocalPerson>('people')
      .toCollection()
      .modify((person) => {
        person.events ??= [];
        if (person.birthday) person.birthday = normalizeBirthday(person.birthday);
      }),
  );

export const entryFromDto = (dto: EntryDto): LocalEntry => ({
  id: dto.id,
  content: dto.content,
  dateKey: dto.dateKey,
  importance: dto.importance,
  tagIds: dto.tags.map((t) => t.id),
  peopleIds: dto.people.map((p) => p.id),
  saidTo: dto.saidTo,
  hiddenFor: dto.hiddenFor,
  parentId: dto.parentId,
  // '' from a not-yet-healed remote doc is falsy, same as a genuinely missing local orderKey —
  // ensureOrderKeys treats both identically the next time this entry's siblings are read.
  orderKey: dto.orderKey || undefined,
  createdAt: dto.createdAt,
  updatedAt: dto.updatedAt,
});

export const personFromDto = (dto: PersonDto): LocalPerson => ({
  id: dto.id,
  name: dto.name,
  aliases: dto.aliases,
  phone: dto.phone,
  email: dto.email,
  wechatId: dto.wechatId,
  birthday: dto.birthday,
  company: dto.company,
  jobTitle: dto.jobTitle,
  contactId: dto.contactId,
  events: dto.events,
  tagIds: dto.tags.map((t) => t.id),
  notes: dto.notes,
  checkupIntervalDays: dto.checkupIntervalDays,
  lastCheckupAt: dto.lastCheckupAt,
  createdAt: dto.createdAt,
});

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Wipe everything local (used on sign-out). Keeps the database usable afterwards. */
export async function clearLocalData(): Promise<void> {
  await db.transaction('rw', [db.entries, db.people, db.tags, db.outbox, db.meta], async () => {
    await Promise.all([
      db.entries.clear(),
      db.people.clear(),
      db.tags.clear(),
      db.outbox.clear(),
      db.meta.clear(),
    ]);
  });
}
