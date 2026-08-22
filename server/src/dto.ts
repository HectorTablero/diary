import type {
  EntryDto,
  PersonDto,
  PersonEventDto,
  PersonRefDto,
  PluginDocumentDto,
  PluginRecordDto,
  PluginScope,
  SaidMark,
  TagDto,
  ThreadDto,
} from '@diary/shared';
import { Types } from 'mongoose';
import type { PopulateOptions } from 'mongoose';

/* Lean documents come out of mongoose with ObjectId instances and populated refs;
   these mappers normalize them into the shared DTO shapes. */

type LeanRef = Types.ObjectId | { _id: Types.ObjectId };

const refId = (ref: LeanRef): string =>
  ref instanceof Types.ObjectId ? ref.toString() : ref._id.toString();

export interface LeanTag {
  _id: Types.ObjectId;
  name: string;
  color: string;
}

export interface LeanThread {
  _id: Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeanPersonEvent {
  id: string;
  title: string;
  startDate: string;
  endDate?: string | null;
  notes?: string;
  askedAt?: Date | null;
  createdAt: Date;
}

const personEventToDto = (event: LeanPersonEvent): PersonEventDto => ({
  id: event.id,
  title: event.title,
  startDate: event.startDate,
  endDate: event.endDate ?? null,
  notes: event.notes ?? '',
  askedAt: event.askedAt ? event.askedAt.toISOString() : null,
  createdAt: event.createdAt.toISOString(),
});

export interface LeanPerson {
  _id: Types.ObjectId;
  name: string;
  // All optional: documents created before contact metadata existed simply lack these keys,
  // and the `??` defaults in personToDto are what let them map without a migration.
  aliases?: string[];
  phone?: string | null;
  email?: string | null;
  birthday?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  contactId?: string | null;
  events?: LeanPersonEvent[];
  tags: LeanTag[];
  notes?: string;
  checkupIntervalDays?: number | null;
  lastCheckupAt?: Date;
  createdAt: Date;
}

export interface LeanSaidMark {
  person: LeanRef;
  at: Date;
}

export interface LeanEntry {
  _id: Types.ObjectId;
  content: string;
  dateKey: string;
  importance: number;
  tags: LeanTag[];
  /** Absent on documents created before threads existed — hence the `?? []` in entryToDto. */
  threads?: LeanThread[];
  people: { _id: Types.ObjectId; name: string }[];
  saidTo: LeanSaidMark[];
  hiddenFor: LeanRef[];
  parentId: Types.ObjectId | null;
  /** Absent on documents created before drag-and-drop reorder existed. */
  orderKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const tagToDto = (tag: LeanTag): TagDto => ({
  id: tag._id.toString(),
  name: tag.name,
  color: tag.color,
});

export const threadToDto = (thread: LeanThread): ThreadDto => ({
  id: thread._id.toString(),
  name: thread.name,
  createdAt: thread.createdAt.toISOString(),
  updatedAt: thread.updatedAt.toISOString(),
});

export interface LeanPluginRecord {
  _id: Types.ObjectId;
  pluginId: string;
  scope: PluginScope;
  dateKey: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/* `data` passes through untouched — the server has no idea what any plugin stores, by design.
   The `??` defaults are the usual read-time tolerance for a document written by a build that
   predated a field, which for this collection also covers a row whose Mixed blob came back as
   null after some other write cleared it. */
export const pluginRecordToDto = (record: LeanPluginRecord): PluginRecordDto => ({
  id: record._id.toString(),
  pluginId: record.pluginId,
  scope: record.scope ?? 'record',
  dateKey: record.dateKey ?? '',
  data: record.data ?? {},
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

export interface LeanPluginDocument {
  _id: Types.ObjectId;
  pluginId: string;
  dateKey: string;
  documentId: string;
  parentId: string;
  title: string;
  body: string;
  sortKey: string;
  added: number;
  removed: number;
  createdAt: Date;
  updatedAt: Date;
}

/* Every `??` here is load-bearing in a way the ones above mostly aren't. A row written by a build
   that predated a field is the usual case; this collection has a second one, because a document and
   a revision each leave half of these at their default and Mongoose omits a defaulted empty string
   from a lean read often enough that reading them as `undefined` would put `undefined` into a Dexie
   compound index — which drops the row out of that index entirely rather than failing. */
export const pluginDocumentToDto = (doc: LeanPluginDocument): PluginDocumentDto => ({
  id: doc._id.toString(),
  pluginId: doc.pluginId,
  dateKey: doc.dateKey ?? '',
  documentId: doc.documentId ?? '',
  parentId: doc.parentId ?? '',
  title: doc.title ?? '',
  body: doc.body ?? '',
  sortKey: doc.sortKey ?? '',
  added: doc.added ?? 0,
  removed: doc.removed ?? 0,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export const personRefToDto = (person: { _id: Types.ObjectId; name: string }): PersonRefDto => ({
  id: person._id.toString(),
  name: person.name,
});

export const personToDto = (person: LeanPerson): PersonDto => ({
  id: person._id.toString(),
  name: person.name,
  aliases: person.aliases ?? [],
  phone: person.phone ?? null,
  email: person.email ?? null,
  birthday: person.birthday ?? null,
  company: person.company ?? null,
  jobTitle: person.jobTitle ?? null,
  contactId: person.contactId ?? null,
  events: (person.events ?? []).map(personEventToDto),
  tags: person.tags.map(tagToDto),
  notes: person.notes ?? '',
  checkupIntervalDays: person.checkupIntervalDays ?? null,
  lastCheckupAt: (person.lastCheckupAt ?? person.createdAt).toISOString(),
  createdAt: person.createdAt.toISOString(),
});

const saidMarkToDto = (mark: LeanSaidMark): SaidMark => ({
  personId: refId(mark.person),
  at: mark.at.toISOString(),
});

export const entryToDto = (entry: LeanEntry): EntryDto => ({
  id: entry._id.toString(),
  content: entry.content,
  dateKey: entry.dateKey,
  importance: entry.importance,
  tags: entry.tags.map(tagToDto),
  threads: (entry.threads ?? []).map(threadToDto),
  people: entry.people.map(personRefToDto),
  saidTo: entry.saidTo.map(saidMarkToDto),
  hiddenFor: entry.hiddenFor.map(refId),
  parentId: entry.parentId ? entry.parentId.toString() : null,
  // '' for a not-yet-healed legacy document — only meaningful once the client has healed it
  // (see ensureOrderKeys in web/src/db/repo.ts); other read paths don't sort by it at all.
  orderKey: entry.orderKey ?? '',
  createdAt: entry.createdAt.toISOString(),
  updatedAt: entry.updatedAt.toISOString(),
});

export const ENTRY_POPULATE: PopulateOptions[] = [
  { path: 'tags', select: 'name color' },
  // createdAt/updatedAt come along because ThreadDto carries them (the threads page sorts by them).
  { path: 'threads', select: 'name createdAt updatedAt' },
  { path: 'people', select: 'name' },
];
