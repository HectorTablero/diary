import type {
  CalendarDay,
  EntryDto,
  EntryNode,
  PersonDto,
  PersonListItem,
  ScoredEntry,
  SearchResponse,
  SettingsDto,
  TagDto,
  TagWithStats,
  TalkingPointsResponse,
} from '@diary/shared';
import {
  buildEntryTree,
  DEFAULT_SETTINGS,
  matchTypeFor,
  memoryCutoffDateKey,
  scoreCutoffDateKey,
  scoreEntry,
} from '@diary/shared';
import { ApiError } from '@/lib/apiClient';
import { fuzzyIncludes } from '@/lib/tokens';
import { db, getMeta, type LocalEntry, type LocalPerson } from './db';

/* Local read layer: mirrors the server's read endpoints over the Dexie store,
   so every page works identically offline. */

interface JoinMaps {
  tags: Map<string, TagDto>;
  people: Map<string, LocalPerson>;
}

async function joinMaps(): Promise<JoinMaps> {
  const [tags, people] = await Promise.all([db.tags.toArray(), db.people.toArray()]);
  return {
    tags: new Map(tags.map((t) => [t.id, t])),
    people: new Map(people.map((p) => [p.id, p])),
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
    saidTo: entry.saidTo,
    hiddenFor: entry.hiddenFor,
    parentId: entry.parentId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function personToDto(person: LocalPerson, tags: Map<string, TagDto>): PersonDto {
  return {
    id: person.id,
    name: person.name,
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
  return (await getMeta<SettingsDto>('settings')) ?? DEFAULT_SETTINGS;
}

// --- Diary day ---

export async function getDayEntries(dateKey: string): Promise<EntryNode[]> {
  const [entries, maps] = await Promise.all([
    db.entries.where('dateKey').equals(dateKey).toArray(),
    joinMaps(),
  ]);
  return buildEntryTree(entries.map((e) => entryToDto(e, maps)));
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

export async function getOnThisDay(dateKey: string): Promise<EntryDto[]> {
  const settings = await getSettings();
  const monthDay = dateKey.slice(4); // "-MM-DD"
  const [entries, maps] = await Promise.all([
    db.entries.where('dateKey').below(dateKey.slice(0, 4) + monthDay).toArray(),
    joinMaps(),
  ]);
  return entries
    .filter(
      (e) => e.dateKey.endsWith(monthDay) && e.importance <= settings.memoryImportanceThreshold,
    )
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, 20)
    .map((e) => entryToDto(e, maps));
}

// --- Search ---

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

  const [all, maps] = await Promise.all([db.entries.toArray(), joinMaps()]);
  const results = all
    .filter((e) => {
      if (tagIds.length && !e.tagIds.some((id) => tagIds.includes(id))) return false;
      if (personIds.length && !e.peopleIds.some((id) => personIds.includes(id))) return false;
      if (importances.length && !importances.includes(e.importance)) return false;
      if (from && e.dateKey < from) return false;
      if (to && e.dateKey > to) return false;
      if (q && !fuzzyIncludes(e.content, q)) return false;
      return true;
    })
    .sort(byDateDesc);

  return {
    results: results.slice((page - 1) * limit, page * limit).map((e) => entryToDto(e, maps)),
    total: results.length,
    page,
    limit,
  };
}

// --- People ---

export async function getPeople(): Promise<PersonListItem[]> {
  const [people, entries, settings, maps] = await Promise.all([
    db.people.toArray(),
    db.entries.toArray(),
    getSettings(),
    joinMaps(),
  ]);
  const now = Date.now();
  const cutoff = scoreCutoffDateKey(settings, now);
  const recent = entries.filter((e) => e.dateKey >= cutoff);
  const broadcastTagIds = new Set(settings.broadcastTagIds);

  return people
    .map((person) => {
      const personTagIds = new Set(person.tagIds);
      let count = 0;
      for (const entry of recent) {
        if (entry.saidTo.some((s) => s.personId === person.id)) continue;
        if (entry.hiddenFor.includes(person.id)) continue;
        const matchType = matchTypeFor(entry, person.id, personTagIds, settings, broadcastTagIds);
        if (!matchType) continue;
        if (scoreEntry(entry, matchType, settings, now) >= settings.epsilon) count++;
      }
      return {
        ...personToDto(person, maps.tags),
        talkingPointCount: Math.min(count, settings.talkingPointsLimit),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
  const [person, entries, settings, maps] = await Promise.all([
    requirePerson(personId),
    db.entries.toArray(),
    getSettings(),
    joinMaps(),
  ]);
  const now = Date.now();
  const cutoff = scoreCutoffDateKey(settings, now);
  const personTagIds = new Set(person.tagIds);
  const broadcastTagIds = new Set(settings.broadcastTagIds);

  const active: ScoredEntry[] = [];
  for (const entry of entries) {
    if (entry.dateKey < cutoff) continue;
    if (entry.saidTo.some((s) => s.personId === personId)) continue;
    if (entry.hiddenFor.includes(personId)) continue;
    const matchType = matchTypeFor(entry, personId, personTagIds, settings, broadcastTagIds);
    if (!matchType) continue;
    const score = scoreEntry(entry, matchType, settings, now);
    if (score < settings.epsilon) continue;
    active.push({ ...entryToDto(entry, maps), score, matchType });
  }
  active.sort((a, b) => b.score - a.score || b.dateKey.localeCompare(a.dateKey));

  const said = entries
    .filter((e) => e.saidTo.some((s) => s.personId === personId))
    .sort(byDateDesc)
    .slice(0, 50)
    .map((e) => entryToDto(e, maps));

  return { active: active.slice(0, settings.talkingPointsLimit), said };
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
  const [tags, entries, people] = await Promise.all([
    db.tags.toArray(),
    db.entries.toArray(),
    db.people.toArray(),
  ]);
  const entryCounts = new Map<string, number>();
  for (const entry of entries)
    for (const id of entry.tagIds) entryCounts.set(id, (entryCounts.get(id) ?? 0) + 1);
  const personCounts = new Map<string, number>();
  for (const person of people)
    for (const id of person.tagIds) personCounts.set(id, (personCounts.get(id) ?? 0) + 1);

  return tags
    .map((tag) => ({
      ...tag,
      entryCount: entryCounts.get(tag.id) ?? 0,
      personCount: personCounts.get(tag.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
