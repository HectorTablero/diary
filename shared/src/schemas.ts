import { z } from 'zod';
import {
  AI_MAX_TRANSCRIPT_LENGTH,
  BIRTHDAY_REGEX,
  DATE_KEY_REGEX,
  HEX_COLOR_REGEX,
  MAX_ALIAS_LENGTH,
  MAX_ALIASES,
  MAX_CONTENT_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_EVENT_TITLE_LENGTH,
  MAX_EVENTS,
  MAX_NOTES_LENGTH,
  MAX_ORGANIZATION_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_WECHAT_ID_LENGTH,
  normalizeBirthday,
  OBJECT_ID_REGEX,
} from './constants';

export const objectIdSchema = z.string().regex(OBJECT_ID_REGEX, 'invalid id');
export const dateKeySchema = z.string().regex(DATE_KEY_REGEX, 'expected YYYY-MM-DD');
export const isoDateTimeSchema = z.iso.datetime();
export const importanceSchema = z.number().int().min(1).max(5);
export const checkupIntervalDaysSchema = z.number().int().min(1).max(3650).nullable();

// --- Entries ---

/** Either a bare person id (legacy shape — the server stamps `at` itself) or an explicit
    `{personId, at}` pair, so a client restoring history (e.g. a backup import) can preserve the
    real historical said-date instead of everything collapsing to "now" on the server. */
export const saidToInputSchema = z
  .array(z.union([objectIdSchema, z.object({ personId: objectIdSchema, at: isoDateTimeSchema })]))
  .max(30);

export const entryCreateSchema = z.object({
  /** Client-generated id + timestamp let offline creates sync later with stable identity and order. */
  id: objectIdSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  content: z.string().trim().min(1).max(MAX_CONTENT_LENGTH),
  dateKey: dateKeySchema,
  importance: importanceSchema.default(3),
  tags: z.array(objectIdSchema).max(30).default([]),
  people: z.array(objectIdSchema).max(30).default([]),
  /** When omitted, the server copies `people` (auto-said on mention). */
  saidTo: saidToInputSchema.optional(),
  parentId: objectIdSchema.nullish().default(null),
  /** Client-generated fractional-index sibling key. When omitted (an older client), the server
      appends the entry to the end of its sibling list instead. */
  orderKey: z.string().min(1).max(200).optional(),
});

export const entryUpdateSchema = z.object({
  content: z.string().trim().min(1).max(MAX_CONTENT_LENGTH).optional(),
  dateKey: dateKeySchema.optional(),
  importance: importanceSchema.optional(),
  tags: z.array(objectIdSchema).max(30).optional(),
  people: z.array(objectIdSchema).max(30).optional(),
  saidTo: saidToInputSchema.optional(),
  hiddenFor: z.array(objectIdSchema).max(30).optional(),
  /** Reparent — moving to a new parentId (or to root with null) is validated against
      MAX_SUB_ENTRY_DEPTH and cycles server-side (see entryService.updateEntry). */
  parentId: objectIdSchema.nullable().optional(),
  /** New sibling position. Required for a drag reorder/reparent; the server also sets this
      itself when only `dateKey` changes (an entry moved to a new day goes to the bottom). */
  orderKey: z.string().min(1).max(200).optional(),
});

// --- People ---

export const aliasesSchema = z.array(z.string().trim().min(1).max(MAX_ALIAS_LENGTH)).max(MAX_ALIASES);
/** Stored as-is even when it isn't E.164: an imported local-format number is still worth
    keeping (the UI flags it), and only the edit form insists on a full international number. */
export const phoneSchema = z.string().trim().max(MAX_PHONE_LENGTH).nullable();
export const emailSchema = z.string().trim().max(MAX_EMAIL_LENGTH).nullable();
export const wechatIdSchema = z.string().trim().max(MAX_WECHAT_ID_LENGTH).nullable();
/* Transform-then-validate, so a legacy `---MM-DD` value is accepted and rewritten to the
   canonical `--MM-DD` on its way into the database — every write quietly heals the row.
   (A queued offline PATCH from a client that predates the fix would otherwise 400 forever.) */
export const birthdaySchema = z
  .string()
  .transform(normalizeBirthday)
  .refine((value) => BIRTHDAY_REGEX.test(value), 'expected YYYY-MM-DD or --MM-DD')
  .nullable();
export const organizationSchema = z.string().trim().max(MAX_ORGANIZATION_LENGTH).nullable();

export const personEventSchema = z
  .object({
    id: objectIdSchema,
    title: z.string().trim().min(1).max(MAX_EVENT_TITLE_LENGTH),
    startDate: dateKeySchema,
    /** `null` means a single-day event — the follow-up math treats it as ending on startDate. */
    endDate: dateKeySchema.nullable().default(null),
    notes: z.string().max(MAX_NOTES_LENGTH).default(''),
    askedAt: isoDateTimeSchema.nullable().default(null),
    createdAt: isoDateTimeSchema,
  })
  // Date keys are ISO, so a plain string compare is a correct date compare.
  .refine((event) => event.endDate === null || event.endDate >= event.startDate, {
    message: 'endDate must not precede startDate',
    path: ['endDate'],
  });

export const eventsSchema = z.array(personEventSchema).max(MAX_EVENTS);

export const personCreateSchema = z.object({
  id: objectIdSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  name: z.string().trim().min(1).max(100),
  aliases: aliasesSchema.default([]),
  phone: phoneSchema.default(null),
  email: emailSchema.default(null),
  wechatId: wechatIdSchema.default(null),
  birthday: birthdaySchema.default(null),
  company: organizationSchema.default(null),
  jobTitle: organizationSchema.default(null),
  contactId: z.string().trim().max(200).nullable().default(null),
  events: eventsSchema.default([]),
  tags: z.array(objectIdSchema).max(50).default([]),
  notes: z.string().max(MAX_NOTES_LENGTH).default(''),
  /** When omitted, the server copies the account's default checkup interval. */
  checkupIntervalDays: checkupIntervalDaysSchema.optional(),
});

// Every field optional and never defaulted — same reasoning as settingsSchema below: a PATCH
// queued by an older client (one that predates these fields) must not blank them on replay.
export const personUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  aliases: aliasesSchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  wechatId: wechatIdSchema.optional(),
  birthday: birthdaySchema.optional(),
  company: organizationSchema.optional(),
  jobTitle: organizationSchema.optional(),
  contactId: z.string().trim().max(200).nullable().optional(),
  events: eventsSchema.optional(),
  tags: z.array(objectIdSchema).max(50).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
  checkupIntervalDays: checkupIntervalDaysSchema.optional(),
});

// --- Tags ---

export const tagCreateSchema = z.object({
  id: objectIdSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
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
  forceEnglishAIEvents: z.boolean().optional(),
  defaultCheckupIntervalDays: checkupIntervalDaysSchema,
  // Both optional and never defaulted: a queued PUT /settings outbox payload from an older
  // client (that predates these fields) must not wipe the stored keys on replay. An
  // explicit "" still clears one.
  groqApiKey: z.string().trim().max(200).optional(),
  openRouterApiKey: z.string().trim().max(200).optional(),
  cerebrasApiKey: z.string().trim().max(200).optional(),
});

// --- AI voice assistant ---

export const aiSuggestionsRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(AI_MAX_TRANSCRIPT_LENGTH),
  dateKey: dateKeySchema,
  language: z.string().max(10).default('es'),
});

/* Query params (validated as strings from the URL). Only /sync takes any: the day, calendar,
   search and pagination queries went with the read endpoints they validated, which the
   local-first client no longer calls. */

export const syncQuerySchema = z.object({
  /** Pull only changes after this instant; omit for a full dump (first sync). */
  since: isoDateTimeSchema.optional(),
});

export type EntryCreateInput = z.infer<typeof entryCreateSchema>;
export type EntryUpdateInput = z.infer<typeof entryUpdateSchema>;
export type PersonCreateInput = z.infer<typeof personCreateSchema>;
export type PersonUpdateInput = z.infer<typeof personUpdateSchema>;
export type PersonEventInput = z.infer<typeof personEventSchema>;
export type TagCreateInput = z.infer<typeof tagCreateSchema>;
export type TagUpdateInput = z.infer<typeof tagUpdateSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type AiSuggestionsRequestInput = z.infer<typeof aiSuggestionsRequestSchema>;
