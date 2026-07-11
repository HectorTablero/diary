import { z } from 'zod';
import {
  DATE_KEY_REGEX,
  HEX_COLOR_REGEX,
  MAX_CONTENT_LENGTH,
  MAX_NOTES_LENGTH,
  OBJECT_ID_REGEX,
} from './constants';

export const objectIdSchema = z.string().regex(OBJECT_ID_REGEX, 'invalid id');
export const dateKeySchema = z.string().regex(DATE_KEY_REGEX, 'expected YYYY-MM-DD');
export const importanceSchema = z.number().int().min(1).max(5);
export const checkupIntervalDaysSchema = z.number().int().min(1).max(3650).nullable();

// --- Entries ---

export const entryCreateSchema = z.object({
  content: z.string().trim().min(1).max(MAX_CONTENT_LENGTH),
  dateKey: dateKeySchema,
  importance: importanceSchema.default(3),
  tags: z.array(objectIdSchema).max(30).default([]),
  people: z.array(objectIdSchema).max(30).default([]),
  /** When omitted, the server copies `people` (auto-said on mention). */
  saidTo: z.array(objectIdSchema).max(30).optional(),
  parentId: objectIdSchema.nullish().default(null),
});

export const entryUpdateSchema = z.object({
  content: z.string().trim().min(1).max(MAX_CONTENT_LENGTH).optional(),
  dateKey: dateKeySchema.optional(),
  importance: importanceSchema.optional(),
  tags: z.array(objectIdSchema).max(30).optional(),
  people: z.array(objectIdSchema).max(30).optional(),
  saidTo: z.array(objectIdSchema).max(30).optional(),
  hiddenFor: z.array(objectIdSchema).max(30).optional(),
});

// --- People ---

export const personCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  tags: z.array(objectIdSchema).max(50).default([]),
  notes: z.string().max(MAX_NOTES_LENGTH).default(''),
  /** When omitted, the server copies the account's default checkup interval. */
  checkupIntervalDays: checkupIntervalDaysSchema.optional(),
});

export const personUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  tags: z.array(objectIdSchema).max(50).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
  checkupIntervalDays: checkupIntervalDaysSchema.optional(),
});

// --- Tags ---

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(HEX_COLOR_REGEX, 'expected #RRGGBB').optional(),
});

export const tagUpdateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().regex(HEX_COLOR_REGEX, 'expected #RRGGBB').optional(),
});

// --- Settings ---

const halfLifeRange = z.number().min(1).max(3650);

export const settingsSchema = z.object({
  halfLifeDays: z.object({
    1: halfLifeRange,
    2: halfLifeRange,
    3: halfLifeRange,
    4: halfLifeRange,
    5: halfLifeRange,
  }),
  epsilon: z.number().min(0.001).max(0.5),
  talkingPointsLimit: z.number().int().min(1).max(200),
  memoryImportanceThreshold: z.number().int().min(1).max(5),
  memoryMinAgeDays: z.number().int().min(0).max(3650),
  broadcastLifeChangingEvents: z.boolean(),
  broadcastTagIds: z.array(objectIdSchema).max(50),
  defaultCheckupIntervalDays: checkupIntervalDaysSchema,
});

// --- Query params (validated as strings from the URL) ---

export const dayQuerySchema = z.object({
  date: dateKeySchema,
});

export const calendarQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2200),
  month: z.coerce.number().int().min(1).max(12),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  /** Comma-separated object ids */
  tags: z.string().optional(),
  people: z.string().optional(),
  /** Comma-separated importance levels */
  importance: z.string().optional(),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type EntryCreateInput = z.infer<typeof entryCreateSchema>;
export type EntryUpdateInput = z.infer<typeof entryUpdateSchema>;
export type PersonCreateInput = z.infer<typeof personCreateSchema>;
export type PersonUpdateInput = z.infer<typeof personUpdateSchema>;
export type TagCreateInput = z.infer<typeof tagCreateSchema>;
export type TagUpdateInput = z.infer<typeof tagUpdateSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
