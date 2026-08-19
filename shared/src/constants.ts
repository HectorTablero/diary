/** Importance goes from 1 (highest) to 5 (lowest), matching the original app. */
export const IMPORTANCE_LEVELS = [1, 2, 3, 4, 5] as const;
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];

/** Hard ceiling on nesting, not the everyday limit — that is `maxSubEntryDepth` in the user's
    settings, which defaults to 2 and cannot be raised past this. The constant stays the bound for
    static validation (the AI parentPath cap) and the default for tree helpers called without one. */
export const MAX_SUB_ENTRY_DEPTH = 5; // root(0) + up to 5 nested levels
/** What a new account gets, and what the app behaved as before nesting depth was configurable. */
export const DEFAULT_SUB_ENTRY_DEPTH = 2;

export const MAX_CONTENT_LENGTH = 2000;
export const MAX_NOTES_LENGTH = 5000;

/** Extra names a person can answer to (nicknames, surname variants, imported display names). */
export const MAX_ALIASES = 10;
export const MAX_ALIAS_LENGTH = 100;
export const MAX_PHONE_LENGTH = 40;
export const MAX_EMAIL_LENGTH = 200;
export const MAX_ORGANIZATION_LENGTH = 100;
export const MAX_WECHAT_ID_LENGTH = 60;

export const MAX_EVENTS = 50;
export const MAX_EVENT_TITLE_LENGTH = 120;

/** Ongoing topics one entry can belong to. Small on purpose: a thread is a topic, not a label. */
export const MAX_THREADS_PER_ENTRY = 10;
export const MAX_THREAD_NAME_LENGTH = 60;

/** How long a finished event stays worth asking about: this many times its own length.
    A weekend trip goes stale in a fortnight; a two-month secondment stays live for a year. */
export const EVENT_REMEMBER_MULTIPLIER = 7;

/** Weight applied per importance level in the talking-points score: 1 → 1.0 … 5 → 0.2 */
export const importanceWeight = (importance: number): number => (6 - importance) / 5;

/** Match strength multipliers: a direct mention beats a shared tag beats a broadcast. */
export const MATCH_STRENGTH = { mention: 1.0, tag: 0.6, broadcast: 0.4 } as const;
export type MatchType = keyof typeof MATCH_STRENGTH;

/** Default half-lives (days) per importance level for talking-point decay. */
export const DEFAULT_HALF_LIFE_DAYS: Record<ImportanceLevel, number> = {
  1: 90,
  2: 30,
  3: 14,
  4: 7,
  5: 3,
};

export const DEFAULT_SETTINGS = {
  halfLifeDays: DEFAULT_HALF_LIFE_DAYS,
  epsilon: 0.05,
  talkingPointsLimit: 50,
  memoryImportanceThreshold: 2,
  memoryMinAgeDays: 180,
  broadcastLifeChangingEvents: false,
  broadcastTagIds: [] as string[],
  forceEnglishAIEvents: false,
  /** Drop the success toasts for everyday actions, keeping errors and the confirmations the
      user cannot otherwise verify. See notifySuccess in web/src/lib/notify.ts. */
  quietNotifications: true,
  /** Importance a fresh entry starts at. `null` = reuse whatever was saved last. */
  defaultImportance: 3 as number | null,
  /** Whether the "already told them" box is pre-ticked when an entry mentions someone. The box is
      always offered either way; this only decides which way it starts. */
  autoSaidOnMention: true,
  /** How deep sub-entries may nest, up to MAX_SUB_ENTRY_DEPTH. */
  maxSubEntryDepth: DEFAULT_SUB_ENTRY_DEPTH,
  /** Default checkup interval inherited by new people. `null` = checkups off by default. */
  defaultCheckupIntervalDays: null as number | null,
  /* Whether each provider key is stored — never the keys themselves. See SettingsDto. */

  /** Groq powers transcription, and text generation when neither of the others is set. */
  hasGroqKey: false,
  /** When set, handles text/tool-calling instead of Groq (OpenRouter has no speech-to-text, so
      transcription still goes through Groq either way). */
  hasOpenRouterKey: false,
  /** Same as above, and takes precedence over OpenRouter. */
  hasCerebrasKey: false,
};

// --- AI voice assistant ---

export const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
export const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo';
export const GROQ_WHISPER_FALLBACK_MODEL = 'whisper-large-v3';
/** Single point of change if this model id ever moves or is renamed on Groq. */
export const GROQ_CHAT_MODEL = 'openai/gpt-oss-120b';
export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
/** Single point of change if this model id ever moves or is renamed on OpenRouter. */
export const OPENROUTER_CHAT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
export const CEREBRAS_API_BASE = 'https://api.cerebras.ai/v1';
/** Single point of change if this model id ever moves or is renamed on Cerebras. */
export const CEREBRAS_CHAT_MODEL = 'gemma-4-31b';
// export const CEREBRAS_CHAT_MODEL = 'gpt-oss-120b';
export const AI_MAX_TOOL_ITERATIONS = 8;
export const AI_MAX_SUBMIT_REMINDERS = 2;
export const AI_MAX_TRANSCRIPT_LENGTH = 20_000;
export const AI_MAX_SUGGESTION_NODES = 40;
export const AI_MAX_RECORDING_MS = 5 * 60_000;
/** Upload ceiling for POST /ai/transcribe. AI_MAX_RECORDING_MS of Opus-in-WebM lands well under
    5 MB; this only has to reject a request our own recorder could not have produced. */
export const AI_MAX_RECORDING_BYTES = 25 * 1024 * 1024;

/** Requests per user per window across both AI routes, together. Sized for the way the feature is
    actually used — a handful of voice notes in a sitting, each costing one transcribe and one
    suggestions call — so it is invisible in normal use and stops a retry loop within a minute. */
export const AI_RATE_LIMIT = 30;
export const AI_RATE_WINDOW_MS = 5 * 60_000;

/** The Android application id. Must match `applicationId` in web/android/app/build.gradle — it is
    half of what Android checks when verifying this site's App Links (the other half is the signing
    certificate), and a mismatch fails silently, as links that simply stop opening the app. */
export const ANDROID_PACKAGE_NAME = 'es.tablerus.diary';

export const LOGO_COLOR = 'rgb(0, 114, 255)';
export const LOGO_LOCAL_COLOR = 'rgb(220, 70, 70)';
export const LOGO_STROKE_WIDTH = 50;
export const LOGO_VIEWBOX = '0 0 500 500';
export const LOGO_DISPLACED_VIEWBOX = '-10 0 490 500';

/** My (Héctor Tablero) personal's portfolio and brand logo, resembling a tab icon (->|)
    In every one of my apps, the logo transforms between the brand and the app logo on different
    moments. In Diary, it does so on sidebar logo hover (web version, tablet+ width) and on the
    Android app's splash screen.
*/
export const BRAND_LOGO_PATHS = [
  { d: 'M 375 250 L 50 250' },
  { d: 'M 300 125 L 375 250 L 300 375' },
  { d: 'M 450 100 L 450 400' },
] as const;

/** App path, matching the number of path corners per path in the brand logo so browsers can
    smoothly transition between them (d property). */
export const APP_LOGO_PATHS = [
  { d: 'M 100 100 L 100 400' },
  { d: 'M 175 100 L 400 250 L 175 400' },
  { d: 'M 200 250 L 100 250' },
] as const;

/**
 * Which of the two logos the Android status-bar notification icon is drawn as: 'brand' for the tab
 * mark (->|), 'app' for the diary D.
 *
 * Both read at a glance at 24dp, which is the only real constraint — Android throws away every
 * colour in this icon and keeps the alpha channel, so it is a silhouette in the status bar whatever
 * the source says. Flipping this constant and re-running `npm run generate:assets` is the whole
 * change; the drawable it writes (android/.../drawable/ic_stat_notify.xml) is generated, ignored by
 * git, and named by `smallIcon` in web/capacitor.config.ts.
 *
 * Annotated with the union rather than inferred, so that switching it doesn't turn every comparison
 * against the other value into a type error.
 */
export const NOTIFICATION_ICON_LOGO: 'brand' | 'app' = 'brand';

/** Palette cycled through when creating tags without an explicit color. */
export const DEFAULT_TAG_COLORS = [
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#96CEB4', // Green
  '#FFEAA7', // Yellow
  '#DDA0DD', // Plum
  '#98D8C8', // Mint
  '#F7DC6F', // Light Yellow
  '#BB8FCE', // Light Purple
  '#85C1E9', // Light Blue
  '#F8C471', // Light Orange
] as const;

/**
 * How long a delete stays pullable as a tombstone.
 *
 * A tombstone is the only evidence a client has that a doc was deleted, so this window is the
 * contract between what the server keeps and how far back a client's sync cursor may reach. Past
 * it the deletes have been pruned and an incremental pull would silently omit them, so `/api/sync`
 * answers such a cursor with a full reset instead (`SyncResponse.reset`).
 *
 * It lives here rather than in the environment because both halves of that contract have to agree
 * on one number — it is protocol, not deployment.
 */
export const TOMBSTONE_RETENTION_DAYS = 180;
export const TOMBSTONE_RETENTION_MS = TOMBSTONE_RETENTION_DAYS * 86_400_000;

export const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/* --- Plugin records ----------------------------------------------------------------------------

   One collection carries every plugin's rows, so that adding a plugin is a client-only change: no
   model, no route, no sync wiring, no Dexie version. The price is that the server cannot know what
   any given `data` blob is *supposed* to look like — it never reads one — so what would normally be
   a schema's job is done by the bounds below instead.

   Deliberately no closed enum of plugin ids. Requiring one would put a `shared/` change and a server
   deploy in front of every new plugin, which is the entire thing this collection exists to avoid.
   MAX_PLUGINS_PER_USER is what keeps that openness from being a way to grow the collection without
   limit. */

/** Plugin ids appear in an index key and a localStorage key, so: lowercase, no separators that
    collide with the i18n key path (`.`) or an i18next namespace (`:`). */
export const PLUGIN_ID_REGEX = /^[a-z][a-z0-9-]{0,31}$/;

/** Distinct plugin ids one account may hold rows for. Generous against the number of plugins that
    will ever ship, small enough that an open `pluginId` can't be used to sprawl the collection. */
export const MAX_PLUGINS_PER_USER = 32;

/** Rows one account may hold for one plugin. A day-scoped plugin writes one row per day, so this is
    roughly 50 years of daily use — reached only by something writing rows it shouldn't. */
export const MAX_PLUGIN_RECORDS_PER_PLUGIN = 20_000;

/** Serialized size cap on a single row's `data`. Enforced on the JSON text rather than on the
    object, because that is the thing that actually costs storage and bandwidth, and it holds even
    for a shape no per-field rule anticipated. */
export const MAX_PLUGIN_DATA_BYTES = 4096;

/** How deep a `data` blob may nest. Plugin data is settings and per-day values; anything deeper is
    a document, and documents belong in the pluginDocument collection below. */
export const MAX_PLUGIN_DATA_DEPTH = 3;

/** The sentinel `dateKey` for a row that isn't about a particular day.
 *
 * Empty string rather than null, and this is not cosmetic: IndexedDB cannot index null, and a
 * compound index requires *every* keypath to hold a valid key. A null here would silently drop the
 * row out of Dexie's `[pluginId+dateKey]` index — the row would exist, and every query through that
 * index would behave as though it did not. `''` is a valid key and sorts before every real date. */
export const UNDATED_KEY = '';

/* --- Plugin documents --------------------------------------------------------------------------

   The second plugin collection, and the one exception to "adding a plugin is a client-only change".

   `pluginRecord` above is deliberately hostile to documents: 4 KB, depth 3, one opaque blob the
   server never reads. That is right for settings and per-day values and wrong for prose, and no
   amount of raising the cap fixes the part that actually matters — a row carrying a whole document
   is the one shape where last-write-wins destroys something a person spent an evening on.

   So documents get their own collection, with two properties `pluginRecord` cannot have:

   1. **Typed, not opaque.** `body` is a known string field rather than a Mixed blob, which is what
      lets the app rewrite `@mentions` inside it when a person is renamed *without loading the
      owning plugin* — see renamePerson in web/src/db/mutations.ts. A rename must reach a disabled
      plugin's prose, and nothing that loads plugin code could do that.
   2. **History as rows, not as a field.** A revision is its own row, so two devices writing on two
      days write two rows and neither can clobber the other. Only same-day edits collide, and the
      unique index below turns that into the ordinary 409-on-create the whole app already converges
      through.
   3. **A body that is merged rather than overwritten.** The two above make the *history* safe; they
      do nothing for the text itself, which is one field and was therefore still last-write-wins —
      two devices open on one thought, and the slower one's paragraph was gone. `baseVersion` on the
      update schema is what closed that: a body write says which version it was built on and the
      server refuses it if the row has moved, so the client can merge the two versions and try
      again. See db/pluginDocumentMerge.ts in the web client for the whole loop.

   Kept to *one* collection with two row shapes, told apart by `dateKey` — the same idiom the habits
   plugin uses within pluginRecord — because two collections would be two models, two routes, two
   sync branches and two Dexie tables to say one thing. */

/** Byte cap on one document's `body`, measured on the UTF-8 encoding rather than on `length`: the
    cost is bytes stored and bytes synced, and a Japanese document is three times its length. */
export const MAX_PLUGIN_DOCUMENT_BYTES = 262_144;

/** Rows one account may hold for one plugin, documents and revisions together. Revisions are the
    half that grows on its own, at most one per document per day. */
export const MAX_PLUGIN_DOCUMENT_ROWS_PER_PLUGIN = 50_000;

/** A title is a tree label, not content — anything longer belongs in the body. */
export const MAX_PLUGIN_DOCUMENT_TITLE_LENGTH = 120;

/** How deep the document tree may nest. Enforced on the client, which is the only side that knows
    the tree: the server sees `parentId` as an opaque string and never walks it. */
export const MAX_PLUGIN_DOCUMENT_DEPTH = 8;

/** The sentinel `parentId`/`documentId` for "no such link", for the same indexing reason as
    UNDATED_KEY: IndexedDB cannot index null, and both fields sit in compound indexes. */
export const NO_PARENT_KEY = '';

/** `YYYY-MM-DD`, or vCard-style `--MM-DD` when the year is unknown — phone contacts very
    often store a birthday without one, so the year can never be required.
    Note the alternation covers the trailing dash: it's `YYYY-` or `--`, then `MM-DD`. */
export const BIRTHDAY_REGEX = /^(?:\d{4}-|--)(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/* --- LEGACY birthday format: droppable at the next Dexie upversion ---------------------------
   An early build appended the month separator after the `--` year placeholder, writing a
   year-less birthday as `---10-10` (three dashes) instead of `--10-10`. Those rows are already
   in Mongo and in people's local Dexie, so both are still *read* and normalized on write.

   To remove: bump db.version(3) in web/src/db/db.ts with an .upgrade() that rewrites
   `people.birthday` through normalizeBirthday, run it long enough for clients to migrate, then
   delete LEGACY_YEARLESS_BIRTHDAY_REGEX + normalizeBirthday and their call sites (the Zod
   birthdaySchema and parseBirthday). See the marker comment in web/src/db/db.ts. */

export const LEGACY_YEARLESS_BIRTHDAY_REGEX = /^---(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/** Accepts either format, always returns the canonical one. */
export const normalizeBirthday = (value: string): string =>
  LEGACY_YEARLESS_BIRTHDAY_REGEX.test(value) ? value.slice(1) : value;

/** Full international number. Only a number in this shape can open a WhatsApp chat. */
export const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/** ObjectId-shaped id (timestamp prefix + random) generated client-side for offline creates. */
export function newObjectId(): string {
  const time = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0');
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return time + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
