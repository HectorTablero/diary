/** Importance goes from 1 (highest) to 5 (lowest), matching the original app. */
export const IMPORTANCE_LEVELS = [1, 2, 3, 4, 5] as const;
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];

export const MAX_SUB_ENTRY_DEPTH = 2; // root(0) + up to 2 nested levels

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
  /** Default checkup interval inherited by new people. `null` = checkups off by default. */
  defaultCheckupIntervalDays: null as number | null,
  /** User's own Groq API key for the voice-to-entry assistant (transcription; also the text
      fallback when no OpenRouter/Cerebras key is set). Empty = feature disabled. */
  groqApiKey: '',
  /** User's own OpenRouter API key. When set, it's used for text/tool-calling instead of Groq
      (transcription still always goes through Groq — OpenRouter has no speech-to-text). */
  openRouterApiKey: '',
  /** User's own Cerebras API key. When set, it's used for text/tool-calling instead of Groq
    (transcription still always goes through Groq — Cerebras has no speech-to-text). */
  cerebrasApiKey: '',
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

export const LOGO_COLOR = 'rgb(0, 114, 255)';
export const LOGO_LOCAL_COLOR = 'rgb(220, 70, 70)';
export const LOGO_STROKE_WIDTH = 50;
export const LOGO_VIEWBOX = '0 0 500 500';
export const LOGO_DISPLACED_VIEWBOX = '-10 0 490 500';

export const BRAND_LOGO_PATHS = [
  { d: 'M 375 250 L 50 250' },
  { d: 'M 300 125 L 375 250 L 300 375' },
  { d: 'M 450 100 L 450 400' },
] as const;

export const APP_LOGO_PATHS = [
  { d: 'M 100 100 L 100 400' },
  { d: 'M 175 100 L 400 250 L 175 400' },
  { d: 'M 200 250 L 100 250' },
] as const;

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

export const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

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

export const LEGACY_YEARLESS_BIRTHDAY_REGEX =
  /^---(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

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
