import type { MatchType } from './constants';

export interface TagDto {
  id: string;
  name: string;
  color: string;
}

export interface TagWithStats extends TagDto {
  entryCount: number;
  personCount: number;
}

/**
 * A named, cross-day grouping of entries about one ongoing topic — a research project, a
 * house move. Deliberately *not* a tag: threads never take part in person matching or
 * broadcasting (see matchTypeFor), they exist purely so related entries can be read, and
 * caught someone up on, as one unit.
 */
export interface ThreadDto {
  id: string;
  name: string;
  /* No colour, deliberately, unlike TagDto: a thread is identified by its name and its icon. The
     app's palette is greyscale, so a per-thread colour could only be shown as coloured text or a
     tinted border — both of which read at poor contrast against a card in at least one theme. */
  createdAt: string;
  updatedAt: string;
}

export interface ThreadWithStats extends ThreadDto {
  entryCount: number;
}

export interface PersonRefDto {
  id: string;
  name: string;
}

/** Something that happened *to* a person — a trip, an exam, a move — worth asking them about after. */
export interface PersonEventDto {
  /** Client-generated, so an event created offline keeps its identity when it syncs. */
  id: string;
  title: string;
  /** YYYY-MM-DD. */
  startDate: string;
  /** YYYY-MM-DD, or `null` for a single-day event. */
  endDate: string | null;
  notes: string;
  /** When the follow-up ("did you ask them?") was marked done. `null` = still pending. */
  askedAt: string | null;
  createdAt: string;
}

export interface PersonDto {
  id: string;
  name: string;
  /** Embedded rather than a collection of their own: /sync already ships whole PersonDtos, so
      these replicate for free. See the note in web/src/db/sync.ts. */
  events: PersonEventDto[];
  /** Other names this person answers to (nicknames, surname variants). Widens @mention
      autocomplete and the AI's person search without touching the canonical `name`. */
  aliases: string[];
  /** E.164 (`+34600123456`) when it could be normalized; otherwise whatever the contact held,
      which the UI flags as incomplete. Only an E.164 number can open a WhatsApp chat. */
  phone: string | null;
  email: string | null;
  /** WeChat ID, deep-linked as `weixin://dl/chat?<id>`. */
  wechatId: string | null;
  /** `YYYY-MM-DD`, or `--MM-DD` when the year is unknown (see BIRTHDAY_REGEX). */
  birthday: string | null;
  company: string | null;
  jobTitle: string | null;
  /** The device contact this person came from, so re-importing updates instead of duplicating. */
  contactId: string | null;
  tags: TagDto[];
  notes: string;
  /** Days between checkup reminders for this person. `null` disables checkups. */
  checkupIntervalDays: number | null;
  /** Last time an interaction was recorded or the checkup was manually marked done. */
  lastCheckupAt: string;
  createdAt: string;
}

export interface PersonListItem extends PersonDto {
  talkingPointCount: number;
}

export interface SaidMark {
  personId: string;
  /** When this entry was marked as said to this person. */
  at: string;
}

export interface EntryDto {
  id: string;
  content: string;
  dateKey: string;
  importance: number;
  tags: TagDto[];
  people: PersonRefDto[];
  /** Ongoing topics this entry is part of. Purely organisational — no effect on matching. */
  threads: ThreadDto[];
  /** People this entry has been marked as said to, with the date it happened. */
  saidTo: SaidMark[];
  /** Person ids this entry is hidden for (never a talking point). */
  hiddenFor: string[];
  parentId: string | null;
  /** Fractional-index sort key among siblings (lexicographic ordinal compare, not localeCompare).
      Legacy entries are healed to a real value lazily on read — see ensureOrderKeys in
      web/src/db/repo.ts — so this is only reliably populated after that has run at least once. */
  orderKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntryNode extends EntryDto {
  children: EntryNode[];
}

export interface TalkingPointNode extends EntryDto {
  /** Non-null only when this specific node matches the person on its own merits. */
  matchType: MatchType | null;
  score: number;
  children: TalkingPointNode[];
}

export interface TalkingPointsResponse {
  active: TalkingPointNode[];
  said: EntryDto[];
}

/**
 * One row of the person profile's Talking Points tab: either a thread with every one of its
 * live clusters gathered under it, or (when `thread` is null) a single ungrouped cluster.
 * Built by groupTalkingPointsByThread.
 */
export interface TalkingPointGroup {
  /** `null` for an ungrouped cluster, which is rendered exactly as it was before threads. */
  thread: ThreadDto | null;
  clusters: TalkingPointNode[];
  /**
   * Exactly the entry ids a single "mark all as said" writes: nodes that match this person on
   * their own merits *and* belong to this thread. Members that have decayed away, are already
   * said, or are hidden for this person are absent — which is what keeps a bulk mark honest.
   */
  markableIds: string[];
  /** Best score among the group's matching nodes; groups are ordered by it, descending. */
  score: number;
}

export interface CalendarDay {
  date: string;
  count: number;
  /** Lowest importance number present that day (1 = highest importance). */
  maxImportance: number;
}

export interface SearchResponse {
  results: EntryDto[];
  total: number;
  page: number;
  limit: number;
}

export interface SettingsDto {
  halfLifeDays: Record<'1' | '2' | '3' | '4' | '5', number>;
  epsilon: number;
  talkingPointsLimit: number;
  memoryImportanceThreshold: number;
  memoryMinAgeDays: number;
  /** Suggest importance-1 ("life-changing") entries to everyone, not just matching people. */
  broadcastLifeChangingEvents: boolean;
  /** Tags whose entries are suggested to everyone regardless of match. */
  broadcastTagIds: string[];
  /** Force AI dictation suggestions to be written in English, regardless of the transcript language. */
  forceEnglishAIEvents: boolean;
  /** Drop the success toasts for everyday actions. Errors and unverifiable confirmations stay. */
  quietNotifications: boolean;
  /** Default `checkupIntervalDays` inherited by newly created people. `null` = off by default. */
  defaultCheckupIntervalDays: number | null;
  /** User's own Groq API key for the voice-to-entry assistant (transcription; also the text
      fallback when no OpenRouter/Cerebras key is set). Empty = feature disabled. */
  groqApiKey: string;
  /** User's own OpenRouter API key; when set, used for text/tool-calling instead of Groq. */
  openRouterApiKey: string;
    /** User's own Cerebras API key; when set, used for text/tool-calling instead of Groq. */
    cerebrasApiKey: string;
}

// --- AI voice assistant ---

export interface SuggestedEntryNode {
  /** May contain @Name tokens for linked people. */
  content: string;
  /** 1 (highest) .. 5 (lowest). */
  importance: number;
  /** Existing tag ids only. */
  tags: string[];
  /** Existing person ids only. */
  people: string[];
  /** Sub-details, up to MAX_SUB_ENTRY_DEPTH deep. */
  children: SuggestedEntryNode[];
}

export interface AiSuggestionsRequest {
  transcript: string;
  dateKey: string;
  language: string;
  /** Ancestor entry contents, outermost first; omit or leave empty for top-level suggestions. */
  parentPath?: string[];
}

export interface AiSuggestionsResponse {
  entries: SuggestedEntryNode[];
}

export interface ApiError {
  error: string;
}

export type SyncCollection = 'entry' | 'person' | 'tag' | 'thread';

export interface SyncDeletion {
  coll: SyncCollection;
  docId: string;
  deletedAt: string;
}

export interface SyncResponse {
  /** Cursor for the next pull (captured server-side before the queries ran). */
  serverTime: string;
  entries: EntryDto[];
  people: PersonDto[];
  tags: TagDto[];
  threads: ThreadDto[];
  settings: SettingsDto;
  deletions: SyncDeletion[];
}
