import type {
  CalendarDay,
  EntryDto,
  EntryNode,
  PersonDto,
  SearchResponse,
  SettingsDto,
  TagDto,
  TagWithStats,
  TalkingPointsResponse,
  ThreadDto,
  ThreadWithStats,
} from '@diary/shared';
import { entryFingerprint, type ExistingEntryIndex } from '@/lib/backup/conflicts';
import {
  buildEntryTree,
  buildTalkingPointForest,
  countTalkingPointGroups,
  DEFAULT_SETTINGS,
  memoryCutoffDateKey,
  scoreCutoffDateKey,
} from '@diary/shared';
import { generateNKeysBetween } from 'fractional-indexing';
import { ApiError } from '@/lib/apiClient';
import { fuzzyIncludes } from '@/lib/tokens';
import {
  db,
  getLookupVersion,
  getMeta,
  type LocalEntry,
  type LocalPerson,
  type OutboxOp,
} from './db';
import { enqueueBatch } from './outbox';

/* Local read layer: mirrors the server's read endpoints over the Dexie store,
   so every page works identically offline. */

interface JoinMaps {
  tags: Map<string, TagDto>;
  people: Map<string, LocalPerson>;
  threads: Map<string, ThreadDto>;
}

/**
 * The three lookup tables, cached until something writes to them.
 *
 * Almost every read below needs these, and a screen has four to eight queries mounted at once — so
 * rendering one day used to read the whole people table four or five times over, plus tags and
 * threads, before any of it was joined to anything. They are the small tables and they change
 * rarely; the entries table they are joined *onto* is the one that grows.
 *
 * The promise, not the value, is what's held: queries mounting together arrive within the same tick
 * and would otherwise each start their own read. Sharing the in-flight promise collapses that to
 * one, which is most of the win on a cold screen.
 *
 * Nothing expires it on a timer, deliberately. A stale map is not a slow read, it is a renamed tag
 * still showing its old name — and since the result gets cached again by react-query on top of
 * this, a timeout wouldn't heal it either. Correctness rests entirely on db.ts's lookupVersion
 * being bumped, which is why the bump lives where a write cannot skip it (outbox.ts).
 */
let joinMapsCache: { version: number; maps: Promise<JoinMaps> } | null = null;

async function joinMaps(): Promise<JoinMaps> {
  const version = getLookupVersion();
  if (joinMapsCache?.version === version) return joinMapsCache.maps;
  const maps = readJoinMaps().catch((err: unknown) => {
    // A failed read must not become the cached answer for the rest of the session.
    if (joinMapsCache?.maps === maps) joinMapsCache = null;
    throw err;
  });
  joinMapsCache = { version, maps };
  return maps;
}

async function readJoinMaps(): Promise<JoinMaps> {
  const [tags, people, threads] = await Promise.all([
    db.tags.toArray(),
    db.people.toArray(),
    db.threads.toArray(),
  ]);
  return {
    tags: new Map(tags.map((t) => [t.id, t])),
    people: new Map(people.map((p) => [p.id, p])),
    threads: new Map(threads.map((t) => [t.id, t])),
  };
}

/** Unknown ids (deleted tags/people not yet compacted out) are silently dropped. */
function entryToDto(entry: LocalEntry, maps: JoinMaps): EntryDto {
  return {
    id: entry.id,
    content: entry.content,
    dateKey: entry.dateKey,
    importance: entry.importance,
    tags: entry.tagIds.flatMap((id) => maps.tags.get(id) ?? []),
    people: entry.peopleIds.flatMap((id) => {
      const person = maps.people.get(id);
      return person ? [{ id: person.id, name: person.name }] : [];
    }),
    // `?? []` guards rows a mid-flight sync re-put while the v4 upgrade was still pending.
    threads: (entry.threadIds ?? []).flatMap((id) => maps.threads.get(id) ?? []),
    saidTo: entry.saidTo,
    hiddenFor: entry.hiddenFor,
    parentId: entry.parentId,
    // '' off the getDayEntries path, which always heals first (see ensureOrderKeys) — the other
    // read paths here (search, memories, history...) don't sort by it, so a real value doesn't
    // matter for them.
    orderKey: entry.orderKey ?? '',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Fill in `orderKey` for any entry that doesn't have one yet — rows written before drag-and-drop
 * reorder existed. Mutates and returns the same entries in place. Groups by parentId and, within
 * each group, appends the whole unkeyed batch (sorted by their existing createdAt, so nothing
 * visibly reshuffles) after any already-keyed siblings — "start at the bottom of the list by
 * default" applied to legacy data: the first time a legacy day is viewed, every sibling in a
 * group is unkeyed at once, so the batch is keyed together in its original order. Persists
 * locally and enqueues a sync PATCH per healed row so the fix reaches the server (and, in turn,
 * other devices) too — see the note above db.version(3) in db.ts for the lifecycle this is part of.
 */
async function ensureOrderKeys(entries: LocalEntry[]): Promise<LocalEntry[]> {
  const byParent = new Map<string | null, LocalEntry[]>();
  for (const entry of entries) {
    const siblings = byParent.get(entry.parentId);
    if (siblings) siblings.push(entry);
    else byParent.set(entry.parentId, [entry]);
  }

  const healed: LocalEntry[] = [];
  for (const siblings of byParent.values()) {
    const unkeyed = siblings.filter((e) => !e.orderKey);
    if (!unkeyed.length) continue;
    unkeyed.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const max = siblings.reduce<string | undefined>(
      (acc, e) => (e.orderKey && (!acc || e.orderKey > acc) ? e.orderKey : acc),
      undefined,
    );
    const keys = generateNKeysBetween(max ?? null, null, unkeyed.length);
    unkeyed.forEach((entry, i) => {
      entry.orderKey = keys[i];
      healed.push(entry);
    });
  }
  if (!healed.length) return entries;

  await db.entries.bulkPut(healed);
  await enqueueBatch(
    healed.map((e): OutboxOp => ({
      method: 'PATCH',
      path: `/entries/${e.id}`,
      body: { orderKey: e.orderKey },
    })),
  );
  return entries;
}

/** The subset of an entry the talking-point scorer reads — see ClusterCandidate in shared/scoring. */
const toClusterCandidate = (e: LocalEntry) => ({
  id: e.id,
  parentId: e.parentId,
  dateKey: e.dateKey,
  importance: e.importance,
  tagIds: e.tagIds,
  peopleIds: e.peopleIds,
  threadIds: e.threadIds ?? [],
  saidToIds: e.saidTo.map((s) => s.personId),
  hiddenForIds: e.hiddenFor,
});

function personToDto(person: LocalPerson, tags: Map<string, TagDto>): PersonDto {
  return {
    id: person.id,
    name: person.name,
    // `?? ` guards rows written before the v2 upgrade ran (and any that a mid-flight sync
    // re-put while the upgrade was pending).
    aliases: person.aliases ?? [],
    phone: person.phone ?? null,
    email: person.email ?? null,
    birthday: person.birthday ?? null,
    company: person.company ?? null,
    jobTitle: person.jobTitle ?? null,
    contactId: person.contactId ?? null,
    events: person.events ?? [],
    tags: person.tagIds.flatMap((id) => tags.get(id) ?? []),
    notes: person.notes,
    checkupIntervalDays: person.checkupIntervalDays,
    lastCheckupAt: person.lastCheckupAt,
    createdAt: person.createdAt,
  };
}

const byDateDesc = (a: LocalEntry, b: LocalEntry) =>
  b.dateKey.localeCompare(a.dateKey) || b.createdAt.localeCompare(a.createdAt);

export async function getSettings(): Promise<SettingsDto> {
  const stored = await getMeta<SettingsDto>('settings');
  // Spread over the defaults so metas saved before a field existed (e.g. groqApiKey) still
  // come back with a complete SettingsDto instead of `undefined`.
  return { ...DEFAULT_SETTINGS, ...stored };
}

// --- Diary day ---

export async function getDayEntries(dateKey: string): Promise<EntryNode[]> {
  const [entries, maps] = await Promise.all([
    db.entries.where('dateKey').equals(dateKey).toArray(),
    joinMaps(),
  ]);
  const healed = await ensureOrderKeys(entries);
  return buildEntryTree(healed.map((e) => entryToDto(e, maps)));
}

// --- Calendar ---

export async function getCalendarMonth(year: number, month: number): Promise<CalendarDay[]> {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const entries = await db.entries
    .where('dateKey')
    .between(`${prefix}-01`, `${prefix}-31`, true, true)
    .toArray();
  const days = new Map<string, CalendarDay>();
  for (const entry of entries) {
    if (entry.parentId !== null) continue; // top-level entries only, like the server
    const day = days.get(entry.dateKey);
    if (day) {
      day.count += 1;
      day.maxImportance = Math.min(day.maxImportance, entry.importance);
    } else {
      days.set(entry.dateKey, { date: entry.dateKey, count: 1, maxImportance: entry.importance });
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The same day in earlier years.
 *
 * Asked one year at a time, newest first, rather than by reading everything before today and
 * keeping the rows whose dateKey ends in the right five characters. Twenty results out of a whole
 * diary is a punishing ratio to pay a full scan for, and the answer is a handful of exact keys —
 * `2025-08-08`, `2024-08-08`, … — which is precisely what an index is good at. The number of
 * queries is the age of the diary in years, so it stays in the tens forever.
 *
 * Walking backwards also means the 20-row limit usually stops it after two or three years rather
 * than at the beginning of time. Feb 29 needs no special case: a non-leap year simply matches
 * nothing and the loop moves on.
 */
export async function getOnThisDay(dateKey: string): Promise<EntryDto[]> {
  const settings = await getSettings();
  const monthDay = dateKey.slice(4); // "-MM-DD"
  const thisYear = Number(dateKey.slice(0, 4));
  // One indexed row, and the only thing that decides where the loop stops.
  const earliest = await db.entries.orderBy('dateKey').first();
  if (!earliest) return [];
  const firstYear = Number(earliest.dateKey.slice(0, 4));

  const found: LocalEntry[] = [];
  for (let year = thisYear - 1; year >= firstYear && found.length < 20; year--) {
    const sameDay = await db.entries.where('dateKey').equals(`${year}${monthDay}`).toArray();
    for (const entry of sameDay) {
      if (entry.importance <= settings.memoryImportanceThreshold) found.push(entry);
    }
  }

  const maps = await joinMaps();
  return found
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, 20)
    .map((e) => entryToDto(e, maps));
}

// --- Search ---

/** Inferred rather than written out: Dexie's Collection carries a third parameter for the table's
 *insert* shape, in which the primary key is optional, and naming it by hand gets that wrong. */
type EntryCollection = ReturnType<typeof db.entries.toCollection>;

/**
 * Pick the narrowest index that can serve a filtered entry query, or `null` for "no index helps".
 *
 * Only one index can drive a Dexie query, so this chooses a *prefilter* — a superset of the answer,
 * cheap to obtain — and every filter, including the one that chose it, is still applied in JS by
 * the caller. That redundancy is deliberate: it keeps one predicate as the single definition of a
 * match, so narrowing can never quietly change what search returns, only how much is read to
 * find it.
 *
 * Order is by how much each typically eliminates. A date range is the most selective and cannot
 * duplicate; the two multi-entry indexes come next and can, hence `.distinct()` — `anyOf` on
 * `*tagIds` yields an entry once per tag of its that matched, which would otherwise show the same
 * entry twice and inflate `total`.
 */
function narrowSearch(f: {
  from: string | null;
  to: string | null;
  tagIds: string[];
  personIds: string[];
}): EntryCollection | null {
  if (f.from && f.to) return db.entries.where('dateKey').between(f.from, f.to, true, true);
  if (f.from) return db.entries.where('dateKey').aboveOrEqual(f.from);
  if (f.to) return db.entries.where('dateKey').belowOrEqual(f.to);
  if (f.personIds.length) return db.entries.where('peopleIds').anyOf(f.personIds).distinct();
  if (f.tagIds.length) return db.entries.where('tagIds').anyOf(f.tagIds).distinct();
  return null;
}

/**
 * Rows matching `keep`, streamed rather than materialised.
 *
 * `.each()` hands over one row at a time, so peak memory is the survivors plus a row — where
 * `toArray().filter()` allocates an object for every entry in the diary before the first predicate
 * runs. For a search that matches nine things out of forty thousand, that is the whole difference.
 */
async function collectEntries(
  source: EntryCollection | null,
  keep: (entry: LocalEntry) => boolean,
): Promise<LocalEntry[]> {
  const kept: LocalEntry[] = [];
  await (source ?? db.entries.toCollection()).each((entry) => {
    if (keep(entry)) kept.push(entry);
  });
  return kept;
}

export async function search(params: URLSearchParams): Promise<SearchResponse> {
  const q = params.get('q')?.trim() ?? '';
  const tagIds = (params.get('tags') ?? '').split(',').filter(Boolean);
  const personIds = (params.get('people') ?? '').split(',').filter(Boolean);
  const importances = (params.get('importance') ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  const from = params.get('from');
  const to = params.get('to');
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.get('limit') ?? 50) || 50));

  const results = await collectEntries(narrowSearch({ from, to, tagIds, personIds }), (e) => {
    if (tagIds.length && !e.tagIds.some((id) => tagIds.includes(id))) return false;
    if (personIds.length && !e.peopleIds.some((id) => personIds.includes(id))) return false;
    if (importances.length && !importances.includes(e.importance)) return false;
    if (from && e.dateKey < from) return false;
    if (to && e.dateKey > to) return false;
    if (q && !fuzzyIncludes(e.content, q)) return false;
    return true;
  });
  results.sort(byDateDesc);

  const maps = await joinMaps();
  return {
    results: results.slice((page - 1) * limit, page * limit).map((e) => entryToDto(e, maps)),
    total: results.length,
    page,
    limit,
  };
}

/** Every entry in a date range (optionally tag-filtered), unpaginated and chronological — for
    the "export as Markdown for an agent" feature, which wants everything in range, not a page
    of it. search() above stays paginated/rank-agnostic for the in-app search UI. */
export async function getEntriesInRange(
  from: string | null,
  to: string | null,
  tagIds: string[],
): Promise<EntryDto[]> {
  const entries = await collectEntries(narrowSearch({ from, to, tagIds, personIds: [] }), (e) => {
    if (tagIds.length && !e.tagIds.some((id) => tagIds.includes(id))) return false;
    if (from && e.dateKey < from) return false;
    if (to && e.dateKey > to) return false;
    return true;
  });
  const maps = await joinMaps();
  return entries
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.createdAt.localeCompare(b.createdAt))
    .map((e) => entryToDto(e, maps));
}

// --- People ---

/**
 * The people list itself — no talking-point counts.
 *
 * This is mounted on every route in the app (AppLayout's nav badge calls usePeople for a
 * pending-checkups number), so what it costs is what *every* screen costs. It used to read the
 * whole entries table and then run the talking-point counter once per person — a pass over the
 * diary per person, for a figure exactly one page displays. See getTalkingPointCounts.
 */
export async function getPeople(): Promise<PersonDto[]> {
  const maps = await joinMaps();
  return [...maps.people.values()]
    .map((person) => personToDto(person, maps.tags))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The talking-point badge number per person, for the people list — the one page that shows it.
 *
 * It counts *things you'd bring up*, not matched entries: a matching parent and its matching
 * sub-entries are one cluster, and every live cluster of one thread is one row. So it agrees with
 * the number of rows the profile's Talking Points tab will actually show.
 *
 * Still a pass over the candidates per person, which is the shape countTalkingPointGroups has and
 * which the server shares — but now over the scoring window only, and only while the people list is
 * on screen instead of on every route.
 */
export async function getTalkingPointCounts(): Promise<Record<string, number>> {
  // Through joinMaps rather than its own db.people.toArray(): the people list is on screen beside
  // this, so the read is already cached and this costs nothing.
  const [maps, settings] = await Promise.all([joinMaps(), getSettings()]);
  const now = Date.now();
  const cutoff = scoreCutoffDateKey(settings, now);
  // Indexed rather than read-everything-then-filter: nothing before the scoring cutoff can score
  // above epsilon, so entries older than it cannot affect any count.
  const entries = await db.entries.where('dateKey').aboveOrEqual(cutoff).toArray();
  const recent = entries.map(toClusterCandidate);
  const broadcastTagIds = new Set(settings.broadcastTagIds);

  const counts: Record<string, number> = {};
  for (const person of maps.people.values()) {
    const count = countTalkingPointGroups(
      recent,
      person.id,
      new Set(person.tagIds),
      settings,
      broadcastTagIds,
      now,
    );
    counts[person.id] = Math.min(count, settings.talkingPointsLimit);
  }
  return counts;
}

async function requirePerson(personId: string): Promise<LocalPerson> {
  const person = await db.people.get(personId);
  if (!person) throw new ApiError(404, 'person.not_found');
  return person;
}

export async function getPerson(personId: string): Promise<PersonDto> {
  const [person, maps] = await Promise.all([requirePerson(personId), joinMaps()]);
  return personToDto(person, maps.tags);
}

export async function getTalkingPoints(personId: string): Promise<TalkingPointsResponse> {
  const [person, settings, maps] = await Promise.all([
    requirePerson(personId),
    getSettings(),
    joinMaps(),
  ]);
  const now = Date.now();
  const cutoff = scoreCutoffDateKey(settings, now);
  const personTagIds = new Set(person.tagIds);
  const broadcastTagIds = new Set(settings.broadcastTagIds);

  const [inWindow, all] = await Promise.all([
    // Full date-range set (not just matching candidates): a matching sub-entry
    // needs its non-matching ancestors/siblings available as context too. The range is the
    // scoring window, which the dateKey index can serve directly.
    db.entries.where('dateKey').aboveOrEqual(cutoff).toArray(),
    /* Can't narrow this with the `peopleIds` index: "mark as said" is offered on tag- and
       broadcast-matched entries too (see matchTypeFor in shared/scoring), and those entries never
       get this person added to `peopleIds` — only a direct mention does. Querying `peopleIds` here
       silently dropped every said-mark that came from a tag or broadcast match, which is why the
       Talking Points tab's "Already told" section could render empty even with marks on record. */
    db.entries.toArray(),
  ]);

  const active = buildTalkingPointForest(
    inWindow.map((e) => entryToDto(e, maps)),
    personId,
    personTagIds,
    settings,
    broadcastTagIds,
    now,
  ).slice(0, settings.talkingPointsLimit);

  const said = all
    .filter((e) => e.saidTo.some((s) => s.personId === personId))
    .sort(byDateDesc)
    .slice(0, 50)
    .map((e) => entryToDto(e, maps));

  return { active, said };
}

/** Full index for backup-import conflict detection: every id plus a content fingerprint map so
    re-imports under different ids are recognised as duplicates. */
export async function getEntryIndex(): Promise<ExistingEntryIndex> {
  const entries = await db.entries.toArray();
  const byFingerprint = new Map<string, string>();
  const byId = new Map<string, { content: string }>();
  for (const entry of entries) {
    const fp = entryFingerprint(entry);
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, entry.id);
    byId.set(entry.id, { content: entry.content.slice(0, 80) });
  }
  return {
    ids: new Set(entries.map((e) => e.id)),
    byFingerprint,
    byId,
  };
}

/** Entries mentioning this person, created since they were added, that were never marked as said
    to them — the "things you haven't caught them up on yet" count for the agent briefing export. */
export async function getUnsaidCount(personId: string): Promise<number> {
  const [person, entries] = await Promise.all([
    requirePerson(personId),
    db.entries.where('peopleIds').equals(personId).toArray(),
  ]);
  return entries.filter(
    (e) => e.createdAt >= person.createdAt && !e.saidTo.some((s) => s.personId === personId),
  ).length;
}

export async function getMemories(personId: string): Promise<EntryDto[]> {
  const [, entries, settings, maps] = await Promise.all([
    requirePerson(personId),
    db.entries.where('peopleIds').equals(personId).toArray(),
    getSettings(),
    joinMaps(),
  ]);
  const cutoff = memoryCutoffDateKey(settings, Date.now());
  return entries
    .filter((e) => e.importance <= settings.memoryImportanceThreshold && e.dateKey <= cutoff)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.createdAt.localeCompare(b.createdAt))
    .map((e) => entryToDto(e, maps));
}

export async function getHistory(
  personId: string,
  page: number,
  limit: number,
): Promise<{ results: EntryDto[]; total: number; page: number; limit: number }> {
  const [, entries, maps] = await Promise.all([
    requirePerson(personId),
    db.entries.where('peopleIds').equals(personId).toArray(),
    joinMaps(),
  ]);
  entries.sort(byDateDesc);
  return {
    results: entries.slice((page - 1) * limit, page * limit).map((e) => entryToDto(e, maps)),
    total: entries.length,
    page,
    limit,
  };
}

// --- Tags ---

export async function getTags(): Promise<TagWithStats[]> {
  const maps = await joinMaps();
  const tags = [...maps.tags.values()];

  /* One count per tag off the *tagIds index, rather than one pass over every entry in the diary.
     Dexie answers these from the index alone — no row is deserialised, nothing is held — so the
     cost is the number of tags, which is a handful, instead of the number of entries, which isn't.
     The whole reason either number exists is the "12 entries · 3 people" line under each tag. */
  const entryCounts = await Promise.all(
    tags.map((tag) => db.entries.where('tagIds').equals(tag.id).count()),
  );

  // People stay an in-memory tally: they're already loaded (joinMaps) and they're the small table.
  const personCounts = new Map<string, number>();
  for (const person of maps.people.values())
    for (const id of person.tagIds) personCounts.set(id, (personCounts.get(id) ?? 0) + 1);

  return tags
    .map((tag, i) => ({
      ...tag,
      entryCount: entryCounts[i],
      personCount: personCounts.get(tag.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- Threads ---

export async function getThreads(): Promise<ThreadWithStats[]> {
  const maps = await joinMaps();
  const threads = [...maps.threads.values()];

  /* Per thread off the *threadIds index rather than one pass over the whole diary. Unlike tags this
     needs more than a count — the ranking below wants each thread's newest day — so it reads the
     member rows, but streamed: `.each()` never holds more than the row in hand, and thread
     membership is sparse, so the rows read are a small fraction of the table either way. */
  const entryCounts = new Map<string, number>();
  const newestDateKey = new Map<string, string>();
  await Promise.all(
    threads.map(async (thread) => {
      let count = 0;
      let newest = '';
      await db.entries
        .where('threadIds')
        .equals(thread.id)
        .each((entry) => {
          count++;
          if (entry.dateKey > newest) newest = entry.dateKey;
        });
      entryCounts.set(thread.id, count);
      if (newest) newestDateKey.set(thread.id, newest);
    }),
  );

  /* Ordered by each thread's newest entry, so a topic you're currently writing about stays at the
     top and a finished one sinks — not by `thread.updatedAt`, which only moves when the thread
     itself is renamed or recoloured and so would rank a long-dead thread you just tidied above a
     live one. A thread with no entries yet falls back to its own creation day; both sides are
     YYYY-MM-DD, so a plain string compare is a correct date compare. */
  const rank = (thread: ThreadDto) => newestDateKey.get(thread.id) ?? thread.createdAt.slice(0, 10);
  return threads
    .map((thread) => ({ ...thread, entryCount: entryCounts.get(thread.id) ?? 0 }))
    .sort((a, b) => rank(b).localeCompare(rank(a)) || a.name.localeCompare(b.name));
}

/** Entries in a thread, newest day first — the member list on the threads page. */
export async function getThreadEntries(threadId: string): Promise<EntryDto[]> {
  const [entries, maps] = await Promise.all([
    db.entries.where('threadIds').equals(threadId).toArray(),
    joinMaps(),
  ]);
  return entries.sort(byDateDesc).map((e) => entryToDto(e, maps));
}
