import type { ScoredEntry, SettingsDto, TalkingPointsResponse } from '@diary/shared';
import { importanceWeight, MATCH_STRENGTH } from '@diary/shared';
import { Types } from 'mongoose';
import { notFound } from '../errors';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { UserSettings } from '../models/userSettings';
import { ENTRY_POPULATE, entryToDto, type LeanEntry } from '../dto';

const DAY_MS = 86_400_000;

export async function getSettings(userId: string): Promise<SettingsDto> {
  const doc = await UserSettings.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return {
    halfLifeDays: doc.halfLifeDays as SettingsDto['halfLifeDays'],
    epsilon: doc.epsilon,
    talkingPointsLimit: doc.talkingPointsLimit,
    memoryImportanceThreshold: doc.memoryImportanceThreshold,
    memoryMinAgeDays: doc.memoryMinAgeDays,
    broadcastLifeChangingEvents: doc.broadcastLifeChangingEvents,
    broadcastTagIds: (doc.broadcastTagIds as Types.ObjectId[]).map((id) => id.toString()),
    defaultCheckupIntervalDays: doc.defaultCheckupIntervalDays,
  };
}

const ageInDays = (dateKey: string, now: number) =>
  Math.max(0, (now - Date.parse(dateKey)) / DAY_MS);

const halfLifeFor = (settings: SettingsDto, importance: number) =>
  settings.halfLifeDays[String(importance) as keyof SettingsDto['halfLifeDays']] ?? 14;

/** score = importanceWeight · matchStrength · 2^(-age / halfLife) */
export function scoreEntry(
  entry: { dateKey: string; importance: number },
  matchType: keyof typeof MATCH_STRENGTH,
  settings: SettingsDto,
  now: number,
) {
  const decay = Math.exp(
    (-ageInDays(entry.dateKey, now) * Math.LN2) / halfLifeFor(settings, entry.importance),
  );
  return importanceWeight(entry.importance) * MATCH_STRENGTH[matchType] * decay;
}

/**
 * Oldest dateKey that could still score >= epsilon for ANY importance level.
 * Bounds candidate queries so old entries are never scanned.
 */
export function scoreCutoffDateKey(settings: SettingsDto, now: number): string {
  let maxAge = 0;
  for (let i = 1; i <= 5; i++) {
    const best = importanceWeight(i) * MATCH_STRENGTH.mention;
    if (best <= settings.epsilon) continue;
    const age = (halfLifeFor(settings, i) * Math.log2(best / settings.epsilon));
    maxAge = Math.max(maxAge, age);
  }
  return new Date(now - Math.ceil(maxAge) * DAY_MS).toISOString().slice(0, 10);
}

interface PersonWithTags {
  _id: Types.ObjectId;
  name: string;
  tags: Types.ObjectId[];
}

/** True if an entry is broadcast to everyone regardless of per-person match. */
function isBroadcast(
  entry: { importance: number; tags: { _id: Types.ObjectId }[] },
  settings: SettingsDto,
  broadcastTagIds: Set<string>,
): boolean {
  if (settings.broadcastLifeChangingEvents && entry.importance === 1) return true;
  return entry.tags.some((t) => broadcastTagIds.has(t._id.toString()));
}

function scoreCandidates(
  entries: LeanEntry[],
  person: PersonWithTags,
  settings: SettingsDto,
  now: number,
): ScoredEntry[] {
  const personId = person._id.toString();
  const personTagIds = new Set(person.tags.map((t) => t.toString()));
  const broadcastTagIds = new Set(settings.broadcastTagIds);

  const scored: ScoredEntry[] = [];
  for (const entry of entries) {
    const mentions = entry.people.some((p) => p._id.toString() === personId);
    const sharesTag = entry.tags.some((t) => personTagIds.has(t._id.toString()));
    if (!mentions && !sharesTag && !isBroadcast(entry, settings, broadcastTagIds)) continue;
    const matchType = mentions ? 'mention' : sharesTag ? 'tag' : 'broadcast';
    const score = scoreEntry(entry, matchType, settings, now);
    if (score < settings.epsilon) continue;
    scored.push({ ...entryToDto(entry), score, matchType });
  }
  scored.sort((a, b) => b.score - a.score || b.dateKey.localeCompare(a.dateKey));
  return scored;
}

/** Candidate query for one person: mentions, shared tag, or a broadcast entry - not hidden, not said, recent enough. */
function candidateQuery(
  userId: string,
  personId: Types.ObjectId,
  tagIds: Types.ObjectId[],
  cutoff: string,
  settings: SettingsDto,
) {
  const or: Record<string, unknown>[] = [{ people: personId }, { tags: { $in: tagIds } }];
  if (settings.broadcastLifeChangingEvents) or.push({ importance: 1 });
  if (settings.broadcastTagIds.length) {
    or.push({ tags: { $in: settings.broadcastTagIds.map((id) => new Types.ObjectId(id)) } });
  }
  return {
    userId,
    dateKey: { $gte: cutoff },
    $or: or,
    hiddenFor: { $ne: personId },
    'saidTo.person': { $ne: personId },
  };
}

export async function getTalkingPoints(
  userId: string,
  personId: string,
): Promise<TalkingPointsResponse> {
  const person = await Person.findOne({ _id: personId, userId }, 'name tags').lean();
  if (!person) throw notFound('person.not_found');

  const settings = await getSettings(userId);
  const now = Date.now();
  const cutoff = scoreCutoffDateKey(settings, now);

  const [candidates, said] = await Promise.all([
    Entry.find(candidateQuery(userId, person._id, person.tags, cutoff, settings))
      .populate(ENTRY_POPULATE)
      .lean(),
    Entry.find({ userId, 'saidTo.person': person._id })
      .sort({ dateKey: -1, createdAt: -1 })
      .limit(50)
      .populate(ENTRY_POPULATE)
      .lean(),
  ]);

  const active = scoreCandidates(
    candidates as unknown as LeanEntry[],
    person as unknown as PersonWithTags,
    settings,
    now,
  ).slice(0, settings.talkingPointsLimit);

  return {
    active,
    said: (said as unknown as LeanEntry[]).map(entryToDto),
  };
}

/** Batch talking-point counts for the people list: one entry scan, per-person scoring in memory. */
export async function countTalkingPoints(userId: string): Promise<Map<string, number>> {
  const people = await Person.find({ userId }, 'name tags').lean();
  const counts = new Map<string, number>();
  if (!people.length) return counts;

  const settings = await getSettings(userId);
  const now = Date.now();
  const cutoff = scoreCutoffDateKey(settings, now);

  const entries = (await Entry.find(
    { userId, dateKey: { $gte: cutoff } },
    'dateKey importance tags people saidTo hiddenFor',
  ).lean()) as unknown as {
    dateKey: string;
    importance: number;
    tags: Types.ObjectId[];
    people: Types.ObjectId[];
    saidTo: { person: Types.ObjectId }[];
    hiddenFor: Types.ObjectId[];
  }[];

  const broadcastTagIds = new Set(settings.broadcastTagIds);

  for (const person of people) {
    const personId = person._id.toString();
    const personTagIds = new Set(person.tags.map((t: Types.ObjectId) => t.toString()));
    let count = 0;
    for (const entry of entries) {
      if (entry.saidTo.some((s) => s.person.toString() === personId)) continue;
      if (entry.hiddenFor.some((id) => id.toString() === personId)) continue;
      const mentions = entry.people.some((id) => id.toString() === personId);
      const sharesTag = entry.tags.some((id) => personTagIds.has(id.toString()));
      const broadcast =
        (settings.broadcastLifeChangingEvents && entry.importance === 1) ||
        entry.tags.some((id) => broadcastTagIds.has(id.toString()));
      if (!mentions && !sharesTag && !broadcast) continue;
      const matchType = mentions ? 'mention' : sharesTag ? 'tag' : 'broadcast';
      const score = scoreEntry(entry, matchType, settings, now);
      if (score >= settings.epsilon) count++;
    }
    counts.set(personId, Math.min(count, settings.talkingPointsLimit));
  }
  return counts;
}

export async function getMemories(userId: string, personId: string) {
  const person = await Person.findOne({ _id: personId, userId }, '_id').lean();
  if (!person) throw notFound('person.not_found');

  const settings = await getSettings(userId);
  const cutoff = new Date(Date.now() - settings.memoryMinAgeDays * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const entries = await Entry.find({
    userId,
    people: person._id,
    importance: { $lte: settings.memoryImportanceThreshold },
    dateKey: { $lte: cutoff },
  })
    .sort({ dateKey: 1, createdAt: 1 })
    .populate(ENTRY_POPULATE)
    .lean();

  return (entries as unknown as LeanEntry[]).map(entryToDto);
}

export async function getHistory(userId: string, personId: string, page: number, limit: number) {
  const person = await Person.findOne({ _id: personId, userId }, '_id').lean();
  if (!person) throw notFound('person.not_found');

  const query = { userId, people: person._id };
  const [total, entries] = await Promise.all([
    Entry.countDocuments(query),
    Entry.find(query)
      .sort({ dateKey: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(ENTRY_POPULATE)
      .lean(),
  ]);

  return { total, page, limit, results: (entries as unknown as LeanEntry[]).map(entryToDto) };
}
