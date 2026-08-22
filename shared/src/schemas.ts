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
  MAX_SUB_ENTRY_DEPTH,
  MAX_THREAD_NAME_LENGTH,
  MAX_THREADS_PER_ENTRY,
  normalizeBirthday,
  MAX_PLUGIN_DATA_BYTES,
  MAX_PLUGIN_DATA_DEPTH,
  MAX_PLUGIN_DOCUMENT_BYTES,
  MAX_PLUGIN_DOCUMENT_TITLE_LENGTH,
  NO_PARENT_KEY,
  OBJECT_ID_REGEX,
  PLUGIN_ID_REGEX,
  UNDATED_KEY,
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
  threads: z.array(objectIdSchema).max(MAX_THREADS_PER_ENTRY).default([]),
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
  threads: z.array(objectIdSchema).max(MAX_THREADS_PER_ENTRY).optional(),
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

export const aliasesSchema = z
  .array(z.string().trim().min(1).max(MAX_ALIAS_LENGTH))
  .max(MAX_ALIASES);
/** Stored as-is even when it isn't E.164: an imported local-format number is still worth
    keeping (the UI flags it), and only the edit form insists on a full international number. */
export const phoneSchema = z.string().trim().max(MAX_PHONE_LENGTH).nullable();
export const emailSchema = z.string().trim().max(MAX_EMAIL_LENGTH).nullable();
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

// --- Threads ---

export const threadCreateSchema = z.object({
  id: objectIdSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  name: z.string().trim().min(1).max(MAX_THREAD_NAME_LENGTH),
});

export const threadUpdateSchema = z.object({
  name: z.string().trim().min(1).max(MAX_THREAD_NAME_LENGTH).optional(),
});

// --- Plugin records ---

export const pluginIdSchema = z.string().regex(PLUGIN_ID_REGEX, 'expected a lowercase plugin id');

/** `YYYY-MM-DD`, or the undated sentinel. See UNDATED_KEY for why it is `''` and not null. */
export const pluginDateKeySchema = z.union([dateKeySchema, z.literal(UNDATED_KEY)]);

/**
 * The bounds that stand in for a schema the server doesn't have.
 *
 * Checked in this order because each rule assumes the previous one held: depth and key shape are
 * walked over a structure already known to be JSON-ish, and the size cap is measured last so the
 * error a caller sees is the most specific one that applies.
 */
function validatePluginData(data: unknown, ctx: z.RefinementCtx): void {
  const reject = (message: string) => ctx.addIssue({ code: 'custom', message });

  const walk = (value: unknown, depth: number, topLevel: boolean): boolean => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      // NaN and Infinity survive a Mongo round-trip but not a JSON one, so a row containing them
      // would read back as null and the plugin would see a value it never wrote.
      if (typeof value === 'number' && !Number.isFinite(value)) {
        reject('data: numbers must be finite');
        return false;
      }
      return true;
    }
    if (depth >= MAX_PLUGIN_DATA_DEPTH) {
      reject(`data: nested deeper than ${MAX_PLUGIN_DATA_DEPTH}`);
      return false;
    }
    if (Array.isArray(value)) return value.every((item) => walk(item, depth + 1, false));
    if (typeof value !== 'object') {
      // undefined, functions, symbols — anything JSON cannot carry.
      reject('data: values must be JSON');
      return false;
    }
    return Object.entries(value as Record<string, unknown>).every(([key, child]) => {
      /* `$`-prefixed and dotted keys are storable in modern Mongo but poison every `$set` path and
         aggregation expression built from them later. Rejected at the top level only, which is
         where an update path would ever be constructed from a key. */
      if (topLevel && (key.startsWith('$') || key.includes('.'))) {
        reject(`data: key "${key}" may not start with $ or contain a dot`);
        return false;
      }
      return walk(child, depth + 1, false);
    });
  };

  if (!walk(data, 0, true)) return;

  if (JSON.stringify(data).length > MAX_PLUGIN_DATA_BYTES) {
    reject(`data: larger than ${MAX_PLUGIN_DATA_BYTES} bytes serialized`);
  }
}

export const pluginDataSchema = z.record(z.string(), z.unknown()).superRefine(validatePluginData);

export const pluginRecordCreateSchema = z.object({
  id: objectIdSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  pluginId: pluginIdSchema,
  scope: z.enum(['config', 'record']).default('record'),
  dateKey: pluginDateKeySchema.default(UNDATED_KEY),
  data: pluginDataSchema,
});

/* `pluginId` and `scope` are absent on purpose: they are the row's identity, not its contents, and
   a row that could change which plugin owns it would let one plugin's write land in another's
   query. Re-scoping means deleting and re-creating. */
export const pluginRecordUpdateSchema = z.object({
  dateKey: pluginDateKeySchema.optional(),
  data: pluginDataSchema.optional(),
});

// --- Plugin documents ---

/* One encoder, reused. `length` is UTF-16 code units and the cap is bytes: for the Japanese and
   Chinese locales this app ships in, the two differ by a factor of three, so measuring the wrong
   one would silently give some users a third of the document the cap promises. */
const encoder = new TextEncoder();

const pluginDocumentBodySchema = z
  .string()
  .refine((body) => encoder.encode(body).length <= MAX_PLUGIN_DOCUMENT_BYTES, {
    message: `body: larger than ${MAX_PLUGIN_DOCUMENT_BYTES} bytes`,
  });

/* An id or the empty sentinel, for the two fields that are a link on one row shape and unused on
   the other. `''` rather than null for the reason NO_PARENT_KEY exists: both sit in Dexie compound
   indexes on the client, and IndexedDB cannot index null. */
const optionalIdSchema = z.union([objectIdSchema, z.literal(NO_PARENT_KEY)]);

export const pluginDocumentCreateSchema = z.object({
  id: objectIdSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  pluginId: pluginIdSchema,
  dateKey: pluginDateKeySchema.default(UNDATED_KEY),
  documentId: optionalIdSchema.default(NO_PARENT_KEY),
  parentId: optionalIdSchema.default(NO_PARENT_KEY),
  title: z.string().max(MAX_PLUGIN_DOCUMENT_TITLE_LENGTH).default(''),
  body: pluginDocumentBodySchema.default(''),
  sortKey: z.string().max(64).default(''),
  added: z.number().int().min(0).default(0),
  removed: z.number().int().min(0).default(0),
});

/* `pluginId`, `dateKey` and `documentId` are absent for the same reason `scope` is absent above:
   together they are which row this is — a document or one day of one — not what it holds. A row
   that could change `dateKey` could turn a document into a revision of itself. */
export const pluginDocumentUpdateSchema = z.object({
  parentId: optionalIdSchema.optional(),
  title: z.string().max(MAX_PLUGIN_DOCUMENT_TITLE_LENGTH).optional(),
  body: pluginDocumentBodySchema.optional(),
  sortKey: z.string().max(64).optional(),
  added: z.number().int().min(0).optional(),
  removed: z.number().int().min(0).optional(),
  /**
   * Write this only if the row is still at this `updatedAt` — a compare-and-swap, not a field.
   *
   * The one guard that makes concurrent editing safe. A document's `body` is the whole text, so a
   * plain PATCH of it is "replace everything with what I have", and two devices doing that a second
   * apart means the slower one's paragraph never existed. With a precondition attached, the second
   * write is refused (409 `pluginDocument.stale_write`) instead of landing, and the client does what
   * `git push` makes you do when it is rejected: pull, merge the two versions properly, push again.
   * See `reconcilePluginDocuments` in the web client.
   *
   * Sent on body writes only. A title or a re-parent is one small field where last-write-wins is
   * both expected and harmless, and making those conditional would only manufacture conflicts
   * between edits that never overlapped.
   *
   * Stripped from the update rather than stored: it describes the write, not the row.
   */
  baseVersion: isoDateTimeSchema.optional(),
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
  // Optional for the same reason as the keys below: a queued PUT from a client that predates
  // this field must not reset it on replay.
  quietNotifications: z.boolean().optional(),
  // Nullable rather than optional: null is a real value here ("reuse the last one"), so it has to
  // survive the round trip, while absence still means "an older client didn't know about this".
  defaultImportance: importanceSchema.nullable().optional(),
  autoSaidOnMention: z.boolean().optional(),
  maxSubEntryDepth: z.number().int().min(1).max(MAX_SUB_ENTRY_DEPTH).optional(),
  defaultCheckupIntervalDays: checkupIntervalDaysSchema,
  /* Provider keys are write-only — the only place they appear in the contract is here, on the way
     up. SettingsDto reports `hasGroqKey`-style booleans instead, so nothing ever sends one back.
     Still optional and never defaulted: a queued PUT /settings from an older client (or simply
     any save that didn't touch the AI section) must not wipe the stored keys on replay. An
     explicit "" is how one gets cleared. */
  groqApiKey: z.string().trim().max(200).optional(),
  openRouterApiKey: z.string().trim().max(200).optional(),
  cerebrasApiKey: z.string().trim().max(200).optional(),
});

// --- AI voice assistant ---

export const aiSuggestionsRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(AI_MAX_TRANSCRIPT_LENGTH),
  dateKey: dateKeySchema,
  language: z.string().max(10).default('es'),
  /** Contents of the existing entries the suggestions will be nested under, outermost first.
      Empty = a normal top-level recording. Its *length* is the depth the suggested roots will
      be created at, which is what shrinks the nesting budget the model is given; its *contents*
      are what tell the model which conversation it is adding detail to. Capped at
      MAX_SUB_ENTRY_DEPTH because an entry that deep can't take children at all. */
  parentPath: z
    .array(z.string().trim().min(1).max(MAX_CONTENT_LENGTH))
    .max(MAX_SUB_ENTRY_DEPTH)
    .default([]),
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
export type ThreadCreateInput = z.infer<typeof threadCreateSchema>;
export type ThreadUpdateInput = z.infer<typeof threadUpdateSchema>;
export type PluginRecordCreateInput = z.infer<typeof pluginRecordCreateSchema>;
export type PluginRecordUpdateInput = z.infer<typeof pluginRecordUpdateSchema>;
export type PluginDocumentCreateInput = z.infer<typeof pluginDocumentCreateSchema>;
export type PluginDocumentUpdateInput = z.infer<typeof pluginDocumentUpdateSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type AiSuggestionsRequestInput = z.infer<typeof aiSuggestionsRequestSchema>;
