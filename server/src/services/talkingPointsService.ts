import type { ClusterCandidate, SettingsDto, TalkingPointsResponse } from '@diary/shared';
import {
  buildTalkingPointForest,
  countMatchingClusters,
  memoryCutoffDateKey,
  scoreCutoffDateKey,
} from '@diary/shared';
import { Types } from 'mongoose';
import { notFound } from '../errors';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { UserSettings } from '../models/userSettings';
import { ENTRY_POPULATE, entryToDto, type LeanEntry } from '../dto';

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
    forceEnglishAIEvents: doc.forceEnglishAIEvents,
    defaultCheckupIntervalDays: doc.defaultCheckupIntervalDays,
    groqApiKey: doc.groqApiKey ?? '',
    openRouterApiKey: doc.openRouterApiKey ?? '',
    cerebrasApiKey: doc.cerebrasApiKey ?? '',
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
  const personTagIds = new Set(person.tags.map((t) => t.toString()));
  const broadcastTagIds = new Set(settings.broadcastTagIds);

  // Full date-range fetch (not just matching candidates): a matching sub-entry
  // needs its non-matching ancestors/siblings available as context too.
  const [candidates, said] = await Promise.all([
    Entry.find({ userId, dateKey: { $gte: cutoff } }).populate(ENTRY_POPULATE).lean(),
    Entry.find({ userId, 'saidTo.person': person._id })
      .sort({ dateKey: -1, createdAt: -1 })
      .limit(50)
      .populate(ENTRY_POPULATE)
      .lean(),
  ]);

  const active = buildTalkingPointForest(
    (candidates as unknown as LeanEntry[]).map(entryToDto),
    personId,
    personTagIds,
    settings,
    broadcastTagIds,
    now,
  ).slice(0, settings.talkingPointsLimit);

  return {
    active,
    said: (said as unknown as LeanEntry[]).map(entryToDto),
  };
}

/** Batch talking-point counts for the people list: one entry scan, per-person scoring in memory.
    A matching parent and its matching sub-entries count as one talking point, so this counts
    distinct root clusters (same grouping as `getTalkingPoints`) rather than raw matched entries. */
export async function countTalkingPoints(userId: string): Promise<Map<string, number>> {
  const people = await Person.find({ userId }, 'name tags').lean();
  const counts = new Map<string, number>();
  if (!people.length) return counts;

  const settings = await getSettings(userId);
  const now = Date.now();
  const cutoff = scoreCutoffDateKey(settings, now);

  const entries = (await Entry.find(
    { userId, dateKey: { $gte: cutoff } },
    'dateKey importance tags people saidTo hiddenFor parentId',
  ).lean()) as unknown as {
    _id: Types.ObjectId;
    parentId: Types.ObjectId | null;
    dateKey: string;
    importance: number;
    tags: Types.ObjectId[];
    people: Types.ObjectId[];
    saidTo: { person: Types.ObjectId }[];
    hiddenFor: Types.ObjectId[];
  }[];

  const candidates: ClusterCandidate[] = entries.map((e) => ({
    id: e._id.toString(),
    parentId: e.parentId ? e.parentId.toString() : null,
    dateKey: e.dateKey,
    importance: e.importance,
    tagIds: e.tags.map((id) => id.toString()),
    peopleIds: e.people.map((id) => id.toString()),
    saidToIds: e.saidTo.map((s) => s.person.toString()),
    hiddenForIds: e.hiddenFor.map((id) => id.toString()),
  }));

  const broadcastTagIds = new Set(settings.broadcastTagIds);

  for (const person of people) {
    const personId = person._id.toString();
    const personTagIds = new Set(person.tags.map((t: Types.ObjectId) => t.toString()));
    const count = countMatchingClusters(
      candidates,
      personId,
      personTagIds,
      settings,
      broadcastTagIds,
      now,
    );
    counts.set(personId, Math.min(count, settings.talkingPointsLimit));
  }
  return counts;
}

export async function getMemories(userId: string, personId: string) {
  const person = await Person.findOne({ _id: personId, userId }, '_id').lean();
  if (!person) throw notFound('person.not_found');

  const settings = await getSettings(userId);
  const cutoff = memoryCutoffDateKey(settings, Date.now());

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
