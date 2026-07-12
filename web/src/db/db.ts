import type { EntryDto, PersonDto, SaidMark, TagDto } from '@diary/shared';
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
  createdAt: string;
  updatedAt: string;
}

export interface LocalPerson {
  id: string;
  name: string;
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
  createdAt: dto.createdAt,
  updatedAt: dto.updatedAt,
});

export const personFromDto = (dto: PersonDto): LocalPerson => ({
  id: dto.id,
  name: dto.name,
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
