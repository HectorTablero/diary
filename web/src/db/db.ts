import type {
  EntryDto,
  PersonDto,
  PersonEventDto,
  PluginDocumentDto,
  PluginRecordDto,
  SaidMark,
  TagDto,
  ThreadDto,
} from '@diary/shared';
import { normalizeBirthday } from '@diary/shared';
import Dexie, { type EntityTable } from 'dexie';
import { clearEnabledMirror } from '@/plugins/enabledMirror';

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
  threadIds: string[];
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
  /**
   * A 404 from the server is expected for this op, and is not a lost write.
   *
   * Set only by the backup importer. Restoring a file written months ago legitimately references
   * things the server no longer has — an entry attached to a person since deleted, a sub-resource
   * whose parent is gone — and those writes come back 404. Nothing was lost: the target stopped
   * existing before the restore began, and no amount of retrying will bring it back.
   *
   * Without this the queue's normal rule applies, and a POST 404 becomes a dead letter and a
   * "5 changes couldn't be saved" toast — a report of data loss for data that was already deleted
   * on purpose. The flag is opt-in and per-op rather than a blanket tolerance because outside a
   * restore a POST 404 is a genuine loss: an entry whose parent doesn't exist is an entry the user
   * wrote and the server refused, and that is exactly what the dead-letter table is for.
   */
  tolerate404?: boolean;
}

/**
 * An op the server refused, kept after it left the queue.
 *
 * The queue has to drop a write the server answers with an unhandled 4xx — retrying it forever
 * would jam every later write behind it. But the local Dexie copy still holds the change, so the
 * UI goes on showing it as saved, and the divergence surfaces only on a second device or after a
 * sign-out. Landing here is what makes that loss a fact the app can report rather than a line in
 * a console nobody reads.
 */
export interface DeadLetterOp {
  id?: number;
  method: OutboxOp['method'];
  path: string;
  body?: unknown;
  /** HTTP status and error code the server answered with. */
  status: number;
  code: string;
  failedAt: string;
}

/**
 * The text a plugin document had the last time this device and the server agreed on it.
 *
 * The merge base — `git`'s remote-tracking ref, in one row. A three-way merge needs a common
 * ancestor to tell "I added this" from "you deleted that", and neither side of a sync can supply
 * one: the local row is what we have now and the server's row is what they have now. This is the
 * third text, captured the moment a clean document is first edited on this device.
 *
 * **Local only.** It never syncs, never appears in a backup, and is not a second copy of the
 * notebook: a row exists only while a document has edits this device hasn't got acknowledged yet,
 * and the pull that confirms the server has them deletes it again. In the ordinary case that is one
 * row, for the document currently open.
 */
export interface PluginDocumentBase {
  /** The document's id. */
  id: string;
  /** Its body as the server last had it. */
  text: string;
  /** The `updatedAt` the server had then — the precondition a body write is sent with. */
  version: string;
}

interface MetaRow {
  key: string;
  value: unknown;
}

export const db = new Dexie('diary') as Dexie & {
  entries: EntityTable<LocalEntry, 'id'>;
  people: EntityTable<LocalPerson, 'id'>;
  tags: EntityTable<TagDto, 'id'>;
  threads: EntityTable<ThreadDto, 'id'>;
  /* Stored as the DTO, like tags and threads: a plugin record references nothing, so there is
     nothing to normalize and no join to keep fresh on rename. */
  pluginRecords: EntityTable<PluginRecordDto, 'id'>;
  /* Also the DTO — but *not* for the reason above. A document's body does carry references: the
     `@Name` text a person mention leaves behind, exactly as denormalized as entry.content is. It is
     kept fresh the same way, by renamePerson rewriting the text (see mutations.ts), which is the one
     thing a normalized id column would have made unnecessary and a plugin-owned blob impossible. */
  pluginDocuments: EntityTable<PluginDocumentDto, 'id'>;
  /* Local-only bookkeeping, not data — see the interface. */
  pluginDocumentBases: EntityTable<PluginDocumentBase, 'id'>;
  outbox: EntityTable<OutboxOp, 'seq'>;
  deadLetter: EntityTable<DeadLetterOp, 'id'>;
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
/* --- orderKey: still no dedicated Dexie upgrade ------------------------------------------------
   Unlike the fields above, LocalEntry.orderKey has no `.upgrade()` here: it's populated lazily
   on read instead, via ensureOrderKeys() in db/repo.ts (called from getDayEntries), following
   the same "read heals the row" idea as normalizeBirthday above.

   The marker that used to live here asked whoever bumped the version next to backfill it. v4
   below deliberately didn't, because the two jobs aren't the same size: ensureOrderKeys groups
   siblings by parentId only, which is correct for the one day it is handed, but a whole-database
   backfill would have to scope root siblings by dateKey as well (all roots share parentId null),
   and getting that subtly wrong silently reorders the user's entire diary. It isn't worth
   attaching to an unrelated feature migration. Do it as its own change: an `.upgrade()` keying
   each `parentId ?? root:<dateKey>` group with generateNKeysBetween, then delete ensureOrderKeys
   and its call site and make LocalEntry.orderKey (and EntryDto.orderKey) required again. */

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

/* v4 adds threads: a named grouping of entries across days, so one ongoing topic can be caught
   someone up on in a single action. Entries carry `threadIds` (multi-indexed, same as tagIds), and
   the backfill is required for the usual reason — a cursor-based pull only re-sends entries the
   server considers changed, so untouched rows would keep `undefined` and break `.includes()`. */
db.version(4)
  .stores({
    entries: 'id, dateKey, parentId, *tagIds, *peopleIds, *threadIds',
    people: 'id, name, *aliases, contactId',
    tags: 'id, name',
    threads: 'id, name',
    outbox: '++seq',
    meta: 'key',
  })
  .upgrade((tx) =>
    tx
      .table<LocalEntry>('entries')
      .toCollection()
      .modify((entry) => {
        entry.threadIds ??= [];
      }),
  );

/* v5 adds the dead-letter table. No `.upgrade()`: it starts empty by definition — it only ever
   holds ops this build's pushOutbox has since refused, and there is nothing in an older database
   to backfill it from. */
db.version(5).stores({
  entries: 'id, dateKey, parentId, *tagIds, *peopleIds, *threadIds',
  people: 'id, name, *aliases, contactId',
  tags: 'id, name',
  threads: 'id, name',
  outbox: '++seq',
  deadLetter: '++id, failedAt',
  meta: 'key',
});

/* v6 adds the shared plugin-record table: one store carrying every plugin's rows, so that adding a
   plugin is a client-only change rather than a full-stack one. No `.upgrade()`, for the same reason
   v5 needed none — the table starts empty by definition, and there is nothing in an older database
   to backfill it from.

   Three indexes on a table most users will never write to, which is worth justifying:
     - `scope` alone answers the one query on the boot path — "which plugins are enabled" is every
       config row at once, rather than a lookup per registered plugin.
     - `[pluginId+dateKey]` is the day lookup a day-scoped plugin's widget makes.
     - `[pluginId+scope]` is a plugin reading its own undated rows without matching another's.

   Note what `dateKey` must never be: IndexedDB cannot index null, and a compound index requires
   *every* keypath to hold a valid key, so a null dateKey would drop the row out of
   `[pluginId+dateKey]` entirely — present in the table, invisible to the query. Undated rows carry
   UNDATED_KEY (`''`), which is a valid key and sorts before every real date. The server refuses
   null at the edge so this cannot arrive from a sync either. */
db.version(6).stores({
  entries: 'id, dateKey, parentId, *tagIds, *peopleIds, *threadIds',
  people: 'id, name, *aliases, contactId',
  tags: 'id, name',
  threads: 'id, name',
  pluginRecords: 'id, pluginId, scope, [pluginId+dateKey], [pluginId+scope]',
  outbox: '++seq',
  deadLetter: '++id, failedAt',
  meta: 'key',
});

/* v7 adds the plugin-document table: prose, and one row per day it changed. No `.upgrade()` — like
   v5 and v6 it starts empty, and there is nothing in an older database to backfill from.

   The three compound indexes, and the query each exists for:
     - `[pluginId+dateKey]` answers both row shapes at once. Equal to `[id, '']` it is every
       document; equal to `[id, '2026-08-18']` it is every revision written that day, which is what
       the day widget and the calendar heatmap read.
     - `[pluginId+dateKey+parentId]` is one document's children. The `dateKey` in the middle is not
       redundant: revisions carry `parentId: ''` too, so without it a query for the *roots* would
       return every revision in the notebook alongside them.
     - `[documentId+dateKey]` is one document's history in date order — the patch chain, replayed
       oldest-first to reconstruct any past day.
   Bodies are large, so no read here is allowed to be "load them all and filter"; each of the three
   is the index that keeps one screen from being proportional to the whole notebook. */
db.version(7).stores({
  entries: 'id, dateKey, parentId, *tagIds, *peopleIds, *threadIds',
  people: 'id, name, *aliases, contactId',
  tags: 'id, name',
  threads: 'id, name',
  pluginRecords: 'id, pluginId, scope, [pluginId+dateKey], [pluginId+scope]',
  pluginDocuments:
    'id, pluginId, dateKey, [pluginId+dateKey], [pluginId+dateKey+parentId], [documentId+dateKey]',
  outbox: '++seq',
  deadLetter: '++id, failedAt',
  meta: 'key',
});

/* v8 adds the plugin-document merge bases: the third text a three-way merge needs, so two devices
   writing the same document stop overwriting each other (see reconcilePluginDocuments in
   db/pluginDocuments.ts). No `.upgrade()`, for the reason v5, v6 and v7 needed none — the table
   holds only in-flight bookkeeping, it starts empty by definition, and there is nothing in an older
   database to backfill it from. A device upgrading mid-edit simply captures its base on the next
   keystroke and is protected from then on.

   One index, the primary key, and deliberately no others: every read here is "the base for this one
   document", by id, and the table is never scanned. */
db.version(8).stores({
  entries: 'id, dateKey, parentId, *tagIds, *peopleIds, *threadIds',
  people: 'id, name, *aliases, contactId',
  tags: 'id, name',
  threads: 'id, name',
  pluginRecords: 'id, pluginId, scope, [pluginId+dateKey], [pluginId+scope]',
  pluginDocuments:
    'id, pluginId, dateKey, [pluginId+dateKey], [pluginId+dateKey+parentId], [documentId+dateKey]',
  pluginDocumentBases: 'id',
  outbox: '++seq',
  deadLetter: '++id, failedAt',
  meta: 'key',
});

export const entryFromDto = (dto: EntryDto): LocalEntry => ({
  id: dto.id,
  content: dto.content,
  dateKey: dto.dateKey,
  importance: dto.importance,
  tagIds: dto.tags.map((t) => t.id),
  peopleIds: dto.people.map((p) => p.id),
  threadIds: (dto.threads ?? []).map((t) => t.id),
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

/**
 * A counter bumped whenever the lookup tables — tags, people, threads — are written.
 *
 * repo.ts caches those three as id→doc maps (see joinMaps) because nearly every read joins against
 * them and re-reading all three per query was most of the cost of opening a screen. This is how it
 * knows the cache is still good.
 *
 * It lives here, in the module both the writer and the reader already depend on, rather than being
 * exported from repo.ts — outbox.ts is where the bump belongs (see invalidateCachesFor there) and
 * repo.ts already imports outbox.ts, so putting it there would close an import cycle.
 */
let lookupVersion = 0;
export const bumpLookupVersion = (): void => {
  lookupVersion++;
};
export const getLookupVersion = (): number => lookupVersion;

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Wipe everything local (used on sign-out). Keeps the database usable afterwards. */
export async function clearLocalData(): Promise<void> {
  /* Not a Dexie table, and that is exactly why it is easy to miss: which plugins are enabled is
     cached in localStorage so the day page has an answer on its first frame, and localStorage
     survives sign-out. Left behind, the next account on a shared device starts with the previous
     account's plugins switched on. Imported from the leaf module rather than plugins/enabled to
     avoid the cycle db → enabled → pluginRecords → db. */
  clearEnabledMirror();
  await db.transaction(
    'rw',
    [
      db.entries,
      db.people,
      db.tags,
      db.threads,
      db.pluginRecords,
      db.pluginDocuments,
      db.pluginDocumentBases,
      db.outbox,
      db.deadLetter,
      db.meta,
    ],
    async () => {
      await Promise.all([
        db.entries.clear(),
        db.people.clear(),
        db.tags.clear(),
        db.threads.clear(),
        db.pluginRecords.clear(),
        db.pluginDocuments.clear(),
        db.pluginDocumentBases.clear(),
        db.outbox.clear(),
        db.deadLetter.clear(),
        db.meta.clear(),
      ]);
    },
  );
  bumpLookupVersion(); // the maps repo.ts may still be holding describe tables that are now empty
}
