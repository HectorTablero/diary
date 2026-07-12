import { importanceWeight, MATCH_STRENGTH, type MatchType } from './constants';
import type { EntryDto, EntryNode, SettingsDto, TalkingPointNode } from './types';

/* Pure talking-points / memories math, shared verbatim by the API and the
   local-first client so the two can never drift apart. */

export const DAY_MS = 86_400_000;

export const ageInDays = (dateKey: string, now: number) =>
  Math.max(0, (now - Date.parse(dateKey)) / DAY_MS);

export const halfLifeFor = (settings: SettingsDto, importance: number) =>
  settings.halfLifeDays[String(importance) as keyof SettingsDto['halfLifeDays']] ?? 14;

/** score = importanceWeight · matchStrength · 2^(-age / halfLife) */
export function scoreEntry(
  entry: { dateKey: string; importance: number },
  matchType: MatchType,
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
 * Bounds candidate scans so old entries are never considered.
 */
export function scoreCutoffDateKey(settings: SettingsDto, now: number): string {
  let maxAge = 0;
  for (let i = 1; i <= 5; i++) {
    const best = importanceWeight(i) * MATCH_STRENGTH.mention;
    if (best <= settings.epsilon) continue;
    const age = halfLifeFor(settings, i) * Math.log2(best / settings.epsilon);
    maxAge = Math.max(maxAge, age);
  }
  return new Date(now - Math.ceil(maxAge) * DAY_MS).toISOString().slice(0, 10);
}

/** Newest dateKey that is already old enough to count as a memory. */
export function memoryCutoffDateKey(settings: SettingsDto, now: number): string {
  return new Date(now - settings.memoryMinAgeDays * DAY_MS).toISOString().slice(0, 10);
}

/**
 * How (and whether) an entry matches a person: direct mention beats shared tag
 * beats broadcast. Works on plain string-id shapes so both sides can use it.
 */
export function matchTypeFor(
  entry: { importance: number; tagIds: string[]; peopleIds: string[] },
  personId: string,
  personTagIds: ReadonlySet<string>,
  settings: SettingsDto,
  broadcastTagIds: ReadonlySet<string>,
): MatchType | null {
  if (entry.peopleIds.includes(personId)) return 'mention';
  if (entry.tagIds.some((id) => personTagIds.has(id))) return 'tag';
  if (settings.broadcastLifeChangingEvents && entry.importance === 1) return 'broadcast';
  if (entry.tagIds.some((id) => broadcastTagIds.has(id))) return 'broadcast';
  return null;
}

/** Assemble a flat list of entry DTOs into parent/children trees, oldest first per level. */
export function buildEntryTree(entries: EntryDto[]): EntryNode[] {
  const nodes = new Map<string, EntryNode>();
  for (const entry of entries) {
    nodes.set(entry.id, { ...entry, children: [] });
  }
  const roots: EntryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byCreation = (a: EntryNode, b: EntryNode) => a.createdAt.localeCompare(b.createdAt);
  const sortTree = (list: EntryNode[]) => {
    list.sort(byCreation);
    list.forEach((n) => sortTree(n.children));
  };
  sortTree(roots);
  return roots;
}

/** True if this node or any node in its subtree matches the person on its own merits. */
export function subtreeHasMatch(node: TalkingPointNode): boolean {
  return node.matchType !== null || node.children.some(subtreeHasMatch);
}

/**
 * Group entries into parent/child trees, keeping only the trees that contain at
 * least one match anywhere, so a matching sub-entry keeps its ancestors visible
 * even when the ancestors themselves don't match. `entries` must be the full set
 * for the relevant date range (not pre-filtered to matches) so context is available.
 */
export function buildTalkingPointForest(
  entries: EntryDto[],
  personId: string,
  personTagIds: ReadonlySet<string>,
  settings: SettingsDto,
  broadcastTagIds: ReadonlySet<string>,
  now: number,
): TalkingPointNode[] {
  const nodes = new Map<string, TalkingPointNode>();
  for (const entry of entries) {
    const matchType = matchTypeFor(
      {
        importance: entry.importance,
        tagIds: entry.tags.map((tag) => tag.id),
        peopleIds: entry.people.map((person) => person.id),
      },
      personId,
      personTagIds,
      settings,
      broadcastTagIds,
    );
    const eligible =
      matchType !== null &&
      !entry.saidTo.some((s) => s.personId === personId) &&
      !entry.hiddenFor.includes(personId);
    const score = eligible ? scoreEntry(entry, matchType!, settings, now) : 0;
    const matched = eligible && score >= settings.epsilon;
    nodes.set(entry.id, {
      ...entry,
      matchType: matched ? matchType : null,
      score: matched ? score : 0,
      children: [],
    });
  }

  const roots: TalkingPointNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byCreation = (a: TalkingPointNode, b: TalkingPointNode) =>
    a.createdAt.localeCompare(b.createdAt);
  const sortTree = (list: TalkingPointNode[]) => {
    list.sort(byCreation);
    list.forEach((n) => sortTree(n.children));
  };
  const maxScore = (node: TalkingPointNode): number =>
    node.children.reduce((max, c) => Math.max(max, maxScore(c)), node.score);

  const kept = roots.filter(subtreeHasMatch);
  sortTree(kept);
  kept.sort((a, b) => maxScore(b) - maxScore(a) || b.dateKey.localeCompare(a.dateKey));
  return kept;
}

/** Minimal shape needed to group matches into clusters, without the display fields
    (content, tag/person names) a full EntryDto carries — cheap to build for a batch scan. */
export interface ClusterCandidate {
  id: string;
  parentId: string | null;
  dateKey: string;
  importance: number;
  tagIds: string[];
  peopleIds: string[];
  saidToIds: string[];
  hiddenForIds: string[];
}

/**
 * Count distinct root-entry clusters that contain at least one match for this
 * person — the same grouping `buildTalkingPointForest` renders, without building
 * full display trees. A matching parent and its matching sub-entry(ies) count as
 * one talking point, not one per matching node.
 */
export function countMatchingClusters(
  entries: ClusterCandidate[],
  personId: string,
  personTagIds: ReadonlySet<string>,
  settings: SettingsDto,
  broadcastTagIds: ReadonlySet<string>,
  now: number,
): number {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const roots = new Set<string>();
  for (const entry of entries) {
    if (entry.saidToIds.includes(personId)) continue;
    if (entry.hiddenForIds.includes(personId)) continue;
    const matchType = matchTypeFor(entry, personId, personTagIds, settings, broadcastTagIds);
    if (!matchType) continue;
    if (scoreEntry(entry, matchType, settings, now) < settings.epsilon) continue;

    let root = entry;
    while (root.parentId) {
      const parent = byId.get(root.parentId);
      if (!parent) break;
      root = parent;
    }
    roots.add(root.id);
  }
  return roots.size;
}
