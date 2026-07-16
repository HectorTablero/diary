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
  objectIdSchema,
  organizationSchema,
  phoneSchema,
  settingsSchema,
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

export const backupEnvelopeSchema = z.object({
  version: z.literal(1),
  exportedAt: isoDateTimeSchema,
  entries: z.array(localEntrySchema),
  people: z.array(localPersonSchema),
  tags: z.array(tagRowSchema),
  settings: settingsSchema,
});

export type EntryBackupRow = z.infer<typeof localEntrySchema>;
export type PersonBackupRow = z.infer<typeof localPersonSchema>;
export type TagBackupRow = z.infer<typeof tagRowSchema>;
export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;
