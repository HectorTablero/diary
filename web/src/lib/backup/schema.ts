import {
  aliasesSchema,
  birthdaySchema,
  checkupIntervalDaysSchema,
  dateKeySchema,
  emailSchema,
  eventsSchema,
  HEX_COLOR_REGEX,
  importanceSchema,
  isoDateTimeSchema,
  MAX_NOTES_LENGTH,
  MAX_THREAD_NAME_LENGTH,
  MAX_THREADS_PER_ENTRY,
  objectIdSchema,
  organizationSchema,
  phoneSchema,
  PLUGIN_ID_REGEX,
  pluginDataSchema,
  settingsSchema,
  UNDATED_KEY,
  wechatIdSchema,
} from '@diary/shared';
import { z } from 'zod';

/* Schemas for the JSON backup file format — a client-only concern, not an API contract, so these
   live here rather than in `shared`. Unlike the create-input schemas in `shared/src/schemas.ts`
   (ids optional, most fields defaulted, shaped for a server POST body), these describe *full
   persisted rows* straight out of Dexie: every id is required, and nothing gets a default,
   because an import either has a value for a field or it doesn't — there's no "the server fills
   this in" step to fall back on. */

const saidMarkSchema = z.object({
  personId: objectIdSchema,
  at: isoDateTimeSchema,
});

export const localEntrySchema = z.object({
  id: objectIdSchema,
  content: z.string(),
  dateKey: dateKeySchema,
  importance: importanceSchema,
  tagIds: z.array(objectIdSchema).max(30),
  peopleIds: z.array(objectIdSchema).max(30),
  /** Defaulted, unlike its neighbours: a version-1 file predates threads entirely. */
  threadIds: z.array(objectIdSchema).max(MAX_THREADS_PER_ENTRY).default([]),
  saidTo: z.array(saidMarkSchema).max(30),
  hiddenFor: z.array(objectIdSchema).max(30),
  parentId: objectIdSchema.nullable(),
  orderKey: z.string().min(1).max(200).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const localPersonSchema = z.object({
  id: objectIdSchema,
  name: z.string().trim().min(1).max(100),
  aliases: aliasesSchema,
  phone: phoneSchema,
  email: emailSchema,
  wechatId: wechatIdSchema,
  birthday: birthdaySchema,
  company: organizationSchema,
  jobTitle: organizationSchema,
  contactId: z.string().trim().max(200).nullable(),
  events: eventsSchema,
  tagIds: z.array(objectIdSchema).max(50),
  notes: z.string().max(MAX_NOTES_LENGTH),
  checkupIntervalDays: checkupIntervalDaysSchema,
  lastCheckupAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const tagRowSchema = z.object({
  id: objectIdSchema,
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(HEX_COLOR_REGEX, 'expected #RRGGBB'),
});

export const threadRowSchema = z.object({
  id: objectIdSchema,
  name: z.string().trim().min(1).max(MAX_THREAD_NAME_LENGTH),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/**
 * One plugin row, as it sits in Dexie.
 *
 * `data` is validated only for the shape the collection guarantees — JSON-ish, bounded — and not
 * for what any particular plugin means by it. That is the same posture the server takes, and for
 * the same reason: the importer cannot know which plugins the file came from, and refusing to
 * restore a row because a plugin that wrote it is not installed here would lose data the user
 * explicitly asked to keep. The owning plugin parses it on read (see plugins/habits/model.ts).
 */
export const pluginRecordRowSchema = z.object({
  id: objectIdSchema,
  pluginId: z.string().regex(PLUGIN_ID_REGEX, 'invalid plugin id'),
  scope: z.enum(['config', 'record']),
  dateKey: z.union([dateKeySchema, z.literal(UNDATED_KEY)]),
  data: pluginDataSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/** What buildBackupEnvelope writes. 2 when threads arrived, 3 when plugins did. */
export const BACKUP_VERSION = 3;

export const backupEnvelopeSchema = z.object({
  /* Older files still import. Version 1 predates threads and version 2 predates plugins; both
     default to empty, so an older file restores as a diary without those things rather than
     refusing to load at all. */
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  exportedAt: isoDateTimeSchema,
  entries: z.array(localEntrySchema),
  people: z.array(localPersonSchema),
  tags: z.array(tagRowSchema),
  threads: z.array(threadRowSchema).default([]),
  pluginRecords: z.array(pluginRecordRowSchema).default([]),
  settings: settingsSchema,
});

export type EntryBackupRow = z.infer<typeof localEntrySchema>;
export type PersonBackupRow = z.infer<typeof localPersonSchema>;
export type TagBackupRow = z.infer<typeof tagRowSchema>;
export type ThreadBackupRow = z.infer<typeof threadRowSchema>;
export type PluginRecordBackupRow = z.infer<typeof pluginRecordRowSchema>;
export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;
