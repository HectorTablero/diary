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
  /** Importance a fresh entry starts at; `null` reuses the last one saved on this device. */
  defaultImportance: number | null;
  /** Whether the "already told them" box starts ticked when an entry mentions someone. */
  autoSaidOnMention: boolean;
  /** How deep sub-entries may nest, 1..MAX_SUB_ENTRY_DEPTH. */
  maxSubEntryDepth: number;
  /** Default `checkupIntervalDays` inherited by newly created people. `null` = off by default. */
  defaultCheckupIntervalDays: number | null;
  /* Provider keys are write-only: they go up through SettingsInput and are never sent back down.
     Only *whether* one is stored crosses the wire, which is all any screen needs — to decide
     whether to show the mic and what the key field should say. The keys themselves stay on the
     server, so they are not in the settings response, not in the IndexedDB mirror, and not in a
     backup file. */

  /** A Groq key is stored. Groq powers transcription, and text generation when neither of the
      others is set. Without one the voice assistant is off. */
  hasGroqKey: boolean;
  /** An OpenRouter key is stored; when so, it handles text/tool-calling instead of Groq. */
  hasOpenRouterKey: boolean;
  /** A Cerebras key is stored; takes precedence over both of the above for text/tool-calling. */
  hasCerebrasKey: boolean;
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

/**
 * What a plugin record is for.
 *
 * `config` is exactly one row per plugin, holding `{ enabled, settings }` — the half of a plugin's
 * configuration that follows the account rather than the device. (Reminders are the other half and
 * live in localStorage; see web/src/lib/preferences.ts for why anything that arms an alarm must.)
 * It is a row rather than a field on SettingsDto so that two devices enabling two different plugins
 * are two independent writes: settings are PUT whole and would clobber each other.
 *
 * `record` is everything else — the plugin's actual data.
 */
export type PluginScope = 'config' | 'record';

/**
 * One row belonging to one plugin.
 *
 * `data` is opaque to the server, which never reads it; the owning plugin parses it on the client
 * with its own schema, in the same defensive posture the backup importer takes toward a file it
 * did not write.
 */
export interface PluginRecordDto {
  id: string;
  pluginId: string;
  scope: PluginScope;
  /** `YYYY-MM-DD`, or UNDATED_KEY (`''`) for a row that isn't about a particular day. */
  dateKey: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of the plugin-document collection: either a document or one day's revision of one.
 *
 * **Two row shapes, told apart by `dateKey`** — the same idiom habits uses inside pluginRecord:
 *
 * | | document | revision |
 * | --- | --- | --- |
 * | `dateKey` | `''` (UNDATED_KEY) | `YYYY-MM-DD` |
 * | `documentId` | `''` | the document it belongs to |
 * | `body` | the current full text | the patch that produces that day's text |
 * | `title`, `parentId`, `sortKey` | used | `''` |
 * | `added` | `0` | net characters added that day |
 *
 * The alternative was two collections, which is two models, two routes, two sync branches and two
 * Dexie tables to express one relationship.
 *
 * ## What the server does and does not know
 *
 * It knows `body` is text, which is the whole reason this collection exists rather than a bigger
 * `pluginRecord`: a typed text field is one the *app* can rewrite `@mentions` in when a person is
 * renamed, without loading the plugin that owns it. It does not know what the text means, does not
 * parse the patch format, and does not walk `parentId` — the tree is the client's, and a cycle or an
 * over-deep move is refused there.
 */
export interface PluginDocumentDto {
  id: string;
  pluginId: string;
  /** UNDATED_KEY (`''`) on a document; `YYYY-MM-DD` on a revision. The discriminator. */
  dateKey: string;
  /** Revisions only: the document this is a revision of. `''` on a document row. */
  documentId: string;
  /** Documents only: the parent in the tree, or `''` for a root. */
  parentId: string;
  /** Documents only. May be empty — the client falls back to the body's first line. */
  title: string;
  /** A document's current text, or a revision's encoded patch. Never inspected by the server. */
  body: string;
  /** Documents only: fractional index among siblings, the same scheme entries sort by. */
  sortKey: string;
  /**
   * Revisions only: characters written that day, and characters taken out.
   *
   * Both are stored rather than derived, because a forward patch cannot answer the second one on its
   * own — it records how many lines were dropped, not what was in them — so recovering `removed`
   * would mean reconstructing the previous day's text. The calendar shades a month by `added` and
   * the day card reports both, and neither may cost a replay of a patch chain.
   *
   * Counted at line granularity, the same granularity the patch and the history view use: a
   * reworded line counts as its old length removed and its new length added. That reads high next
   * to a naive character count and is the truthful answer to "how much writing happened here",
   * which is what both surfaces are asking.
   */
  added: number;
  removed: number;
  createdAt: string;
  updatedAt: string;
}

export type SyncCollection =
  'entry' | 'person' | 'tag' | 'thread' | 'pluginRecord' | 'pluginDocument';

export interface SyncDeletion {
  coll: SyncCollection;
  docId: string;
  deletedAt: string;
}

export interface SyncResponse {
  /** Cursor for the next pull (captured server-side before the queries ran). */
  serverTime: string;
  /**
   * This is the complete server state rather than a delta: either the client sent no cursor, or it
   * sent one older than TOMBSTONE_RETENTION_DAYS.
   *
   * It obliges the client to drop every local doc this response doesn't contain. The deletes an
   * expired cursor missed have had their tombstones pruned, so nothing can name them any more —
   * absence from a full dump is the only evidence left that they happened.
   */
  reset: boolean;
  entries: EntryDto[];
  people: PersonDto[];
  tags: TagDto[];
  threads: ThreadDto[];
  /**
   * Always present, even when empty — never omitted as an optimisation.
   *
   * Under `reset` the client deletes every local id the response did not name, so "the key is
   * absent" and "the account has none" must not look alike: a new client talking to a server that
   * predates this field would read absence as emptiness and delete the lot. The client tolerates
   * `undefined` for exactly that case (a staggered deploy) by *skipping* the sweep for this
   * collection rather than running it — see the `acknowledged` set in web/src/db/sync.ts.
   */
  pluginRecords: PluginRecordDto[];
  /** Always present, even when empty — for exactly the reason spelled out above `pluginRecords`. */
  pluginDocuments: PluginDocumentDto[];
  settings: SettingsDto;
  deletions: SyncDeletion[];
}
