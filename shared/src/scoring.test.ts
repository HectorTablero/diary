import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './constants';
import {
  buildTalkingPointForest,
  countTalkingPointGroups,
  eventFollowUpScore,
  eventLengthDays,
  eventRememberDays,
  groupTalkingPointsByThread,
  isEventFollowUpDue,
  isEventOngoing,
  isEventUpcoming,
  ongoingEvents,
  pendingEventFollowUps,
  type ClusterCandidate,
  type EventLike,
} from './scoring';
import type { EntryDto, SettingsDto, ThreadDto } from './types';

const event = (overrides: Partial<EventLike> = {}): EventLike => ({
  startDate: '2026-07-01',
  endDate: null,
  askedAt: null,
  ...overrides,
});

describe('eventLengthDays', () => {
  it('treats a missing end date as a single day', () => {
    expect(eventLengthDays(event({ startDate: '2026-07-01', endDate: null }))).toBe(1);
  });

  it('counts inclusively', () => {
    expect(eventLengthDays(event({ startDate: '2026-07-01', endDate: '2026-07-01' }))).toBe(1);
    expect(eventLengthDays(event({ startDate: '2026-07-01', endDate: '2026-07-07' }))).toBe(7);
  });

  it('remembers a finished event for 7x its own length', () => {
    expect(eventRememberDays(event({ endDate: null }))).toBe(7);
    expect(eventRememberDays(event({ startDate: '2026-07-01', endDate: '2026-07-14' }))).toBe(98);
  });
});

describe('isEventOngoing / isEventUpcoming', () => {
  const trip = event({ startDate: '2026-07-10', endDate: '2026-07-20' });

  it('spans its whole range, inclusive of both ends', () => {
    expect(isEventOngoing(trip, '2026-07-10')).toBe(true);
    expect(isEventOngoing(trip, '2026-07-15')).toBe(true);
    expect(isEventOngoing(trip, '2026-07-20')).toBe(true);
    expect(isEventOngoing(trip, '2026-07-21')).toBe(false);
    expect(isEventOngoing(trip, '2026-07-09')).toBe(false);
  });

  it('is upcoming only before it starts', () => {
    expect(isEventUpcoming(trip, '2026-07-09')).toBe(true);
    expect(isEventUpcoming(trip, '2026-07-10')).toBe(false);
  });

  it('handles a single-day event with no end date', () => {
    const oneDay = event({ startDate: '2026-07-13', endDate: null });
    expect(isEventOngoing(oneDay, '2026-07-13')).toBe(true);
    expect(isEventOngoing(oneDay, '2026-07-14')).toBe(false);
  });
});

describe('eventFollowUpScore', () => {
  it('is zero while the event is still running', () => {
    const trip = event({ startDate: '2026-07-10', endDate: '2026-07-20' });
    expect(eventFollowUpScore(trip, '2026-07-15')).toBe(0);
  });

  it('is zero on the day it ends — no nagging the same evening', () => {
    const trip = event({ startDate: '2026-07-10', endDate: '2026-07-20' });
    expect(eventFollowUpScore(trip, '2026-07-20')).toBe(0);
    expect(eventFollowUpScore(trip, '2026-07-21')).toBeGreaterThan(0);
  });

  it('is zero once it has been asked about', () => {
    const asked = event({ startDate: '2026-07-01', askedAt: '2026-07-03T10:00:00.000Z' });
    expect(eventFollowUpScore(asked, '2026-07-03')).toBe(0);
    expect(isEventFollowUpDue(asked, '2026-07-03')).toBe(false);
  });

  it('remembers a one-day event for exactly a week, then forgets it', () => {
    const oneDay = event({ startDate: '2026-07-01', endDate: null }); // remember window = 7 days
    expect(isEventFollowUpDue(oneDay, '2026-07-02')).toBe(true); // day 1
    expect(isEventFollowUpDue(oneDay, '2026-07-08')).toBe(true); // day 7 — the last day
    expect(isEventFollowUpDue(oneDay, '2026-07-09')).toBe(false); // day 8 — decayed away
  });

  it('remembers a week-long event far longer (7 x 7 = 49 days)', () => {
    const week = event({ startDate: '2026-07-01', endDate: '2026-07-07' });
    expect(isEventFollowUpDue(week, '2026-08-25')).toBe(true); // day 49
    expect(isEventFollowUpDue(week, '2026-08-26')).toBe(false); // day 50
  });

  it('decays monotonically as the event recedes', () => {
    const trip = event({ startDate: '2026-07-01', endDate: '2026-07-07' });
    const day1 = eventFollowUpScore(trip, '2026-07-08');
    const day10 = eventFollowUpScore(trip, '2026-07-17');
    const day40 = eventFollowUpScore(trip, '2026-08-16');
    expect(day1).toBeGreaterThan(day10);
    expect(day10).toBeGreaterThan(day40);
    expect(day40).toBeGreaterThan(0);
  });

  it('ranks a long event above a short one of the same age', () => {
    // Both ended on 2026-07-07; the fortnight away is the more interesting thing to ask about.
    const fortnight = event({ startDate: '2026-06-24', endDate: '2026-07-07' });
    const oneDay = event({ startDate: '2026-07-07', endDate: null });
    const on = '2026-07-10';
    expect(eventFollowUpScore(fortnight, on)).toBeGreaterThan(eventFollowUpScore(oneDay, on));
  });
});

describe('pendingEventFollowUps', () => {
  it('drops asked, ongoing and long-decayed events, keeping only what is still due', () => {
    const events = [
      { id: 'asked', ...event({ startDate: '2026-07-01', askedAt: '2026-07-05T00:00:00.000Z' }) },
      { id: 'stale', ...event({ startDate: '2026-06-01', endDate: null }) }, // 1-day, long decayed
      { id: 'ongoing', ...event({ startDate: '2026-07-09', endDate: '2026-07-15' }) },
      { id: 'trip', ...event({ startDate: '2026-06-20', endDate: '2026-07-01' }) },
      { id: 'yesterday', ...event({ startDate: '2026-07-09', endDate: null }) },
    ];
    const due = pendingEventFollowUps(events, '2026-07-10');
    expect(new Set(due.map((e) => e.id))).toEqual(new Set(['trip', 'yesterday']));
  });

  it('ranks by how far through its OWN window an event is, not by raw recency', () => {
    // The 12-day trip ended 9 days ago but has an 84-day window — barely started decaying. The
    // one-day thing ended only yesterday, yet is already a seventh of the way through its 7-day
    // window. The trip is the bigger deal, and outranks it. This is the whole point of scaling the
    // decay to the event's length.
    const trip = { id: 'trip', ...event({ startDate: '2026-06-20', endDate: '2026-07-01' }) };
    const yesterday = { id: 'yesterday', ...event({ startDate: '2026-07-09', endDate: null }) };
    const due = pendingEventFollowUps([yesterday, trip], '2026-07-10');
    expect(due.map((e) => e.id)).toEqual(['trip', 'yesterday']);
  });

  it('picks out the ongoing ones separately', () => {
    const events = [
      { id: 'ongoing', ...event({ startDate: '2026-07-09', endDate: '2026-07-15' }) },
      { id: 'past', ...event({ startDate: '2026-07-01', endDate: null }) },
    ];
    expect(ongoingEvents(events, '2026-07-10').map((e) => e.id)).toEqual(['ongoing']);
  });
});

/* --- Threads ------------------------------------------------------------------------------- */

const NOW = Date.parse('2026-07-25T12:00:00.000Z');
const ANA = 'ana';
const settings: SettingsDto = DEFAULT_SETTINGS;

/** A date key `days` before NOW. */
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString().slice(0, 10);

const thread = (id: string): ThreadDto => ({
  id,
  name: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const entry = (over: Partial<EntryDto> & { id: string }): EntryDto => ({
  content: over.id,
  dateKey: daysAgo(0),
  importance: 3,
  tags: [],
  // Mentioning Ana is the strongest match, and the one the profile tab is built around.
  people: [{ id: ANA, name: 'Ana' }],
  threads: [],
  saidTo: [],
  hiddenFor: [],
  parentId: null,
  orderKey: 'a0',
  createdAt: `${over.dateKey ?? daysAgo(0)}T09:00:00.000Z`,
  updatedAt: `${over.dateKey ?? daysAgo(0)}T09:00:00.000Z`,
  ...over,
});

const forestFor = (entries: EntryDto[]) =>
  buildTalkingPointForest(entries, ANA, new Set(), settings, new Set(), NOW);

const groupsFor = (entries: EntryDto[]) => groupTalkingPointsByThread(forestFor(entries));

/** The people-list counter's cheap input shape, derived from the same entries. */
const candidates = (entries: EntryDto[]): ClusterCandidate[] =>
  entries.map((e) => ({
    id: e.id,
    parentId: e.parentId,
    dateKey: e.dateKey,
    importance: e.importance,
    tagIds: e.tags.map((t) => t.id),
    peopleIds: e.people.map((p) => p.id),
    threadIds: e.threads.map((t) => t.id),
    saidToIds: e.saidTo.map((s) => s.personId),
    hiddenForIds: e.hiddenFor,
  }));

const countFor = (entries: EntryDto[]) =>
  countTalkingPointGroups(candidates(entries), ANA, new Set(), settings, new Set(), NOW);

describe('groupTalkingPointsByThread', () => {
  it('leaves an unthreaded forest exactly as it was: one singleton group per cluster, same order', () => {
    const entries = [
      entry({ id: 'old', importance: 3, dateKey: daysAgo(10) }),
      entry({ id: 'big', importance: 1, dateKey: daysAgo(1) }),
    ];
    const forest = forestFor(entries);
    const groups = groupTalkingPointsByThread(forest);

    expect(groups.map((g) => g.thread)).toEqual([null, null]);
    expect(groups.map((g) => g.clusters.map((c) => c.id))).toEqual(forest.map((n) => [n.id]));
  });

  it('gathers one thread’s entries from different days under a single group', () => {
    const research = thread('research');
    const entries = [
      entry({ id: 'a', dateKey: daysAgo(0), threads: [research] }),
      entry({ id: 'b', dateKey: daysAgo(4), threads: [research] }),
      entry({ id: 'c', dateKey: daysAgo(8), importance: 2, threads: [research] }),
    ];
    const groups = groupsFor(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].thread?.id).toBe('research');
    expect(groups[0].clusters).toHaveLength(3);
    expect(new Set(groups[0].markableIds)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('excludes a member that has decayed below epsilon', () => {
    const research = thread('research');
    const entries = [
      entry({ id: 'fresh', importance: 1, dateKey: daysAgo(1), threads: [research] }),
      // importance 5 halves every 3 days from a weight of 0.2, so by day 20 it is far under 0.05.
      entry({ id: 'faded', importance: 5, dateKey: daysAgo(20), threads: [research] }),
    ];
    const groups = groupsFor(entries);

    expect(groups[0].markableIds).toEqual(['fresh']);
    // It isn't on screen either — buildTalkingPointForest already dropped the cluster.
    expect(groups.flatMap((g) => g.clusters.map((c) => c.id))).toEqual(['fresh']);
  });

  it('excludes members already said to this person, or hidden for them', () => {
    const research = thread('research');
    const entries = [
      entry({ id: 'todo', threads: [research] }),
      entry({ id: 'told', threads: [research], saidTo: [{ personId: ANA, at: '2026-07-20T00:00:00.000Z' }] }),
      entry({ id: 'hidden', threads: [research], hiddenFor: [ANA] }),
    ];
    const groups = groupsFor(entries);

    expect(groups[0].markableIds).toEqual(['todo']);
  });

  it('does not carry a mark over to an entry added to the thread afterwards', () => {
    const research = thread('research');
    const before = [
      entry({ id: 'a', threads: [research] }),
      entry({ id: 'b', threads: [research] }),
    ];
    const snapshot = groupsFor(before)[0].markableIds;
    expect(new Set(snapshot)).toEqual(new Set(['a', 'b']));

    // Mark-all writes saidTo for exactly that snapshot, then a new entry joins the thread.
    const said = [{ personId: ANA, at: '2026-07-25T10:00:00.000Z' }];
    const after = [
      entry({ id: 'a', threads: [research], saidTo: said }),
      entry({ id: 'b', threads: [research], saidTo: said }),
      entry({ id: 'c', threads: [research] }),
    ];

    expect(groupsFor(after)[0].markableIds).toEqual(['c']);
  });

  it('gives a cluster spanning two threads exactly one home', () => {
    const entries = [entry({ id: 'both', threads: [thread('t1'), thread('t2')] })];
    const groups = groupsFor(entries);

    expect(groups).toHaveLength(1);
    expect(groups.flatMap((g) => g.clusters)).toHaveLength(1);
    expect(groups[0].markableIds).toEqual(['both']);
  });

  it('shows a matching sibling outside the thread without making it markable', () => {
    const research = thread('research');
    const entries = [
      entry({ id: 'root', threads: [research] }),
      entry({ id: 'aside', parentId: 'root', dateKey: daysAgo(0) }),
    ];
    const groups = groupsFor(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].clusters[0].children.map((c) => c.id)).toEqual(['aside']);
    // 'aside' matches Ana and keeps its own button, but Mark-all is scoped to thread members.
    expect(groups[0].clusters[0].children[0].matchType).toBe('mention');
    expect(groups[0].markableIds).toEqual(['root']);
  });

  it('orders groups by their best member and keeps thread clusters in forest order', () => {
    const research = thread('research');
    const entries = [
      entry({ id: 'r-old', importance: 4, dateKey: daysAgo(3), threads: [research] }),
      entry({ id: 'r-new', importance: 2, dateKey: daysAgo(1), threads: [research] }),
      entry({ id: 'loud', importance: 1, dateKey: daysAgo(0) }),
    ];
    const groups = groupsFor(entries);

    expect(groups.map((g) => g.thread?.id ?? null)).toEqual([null, 'research']);
    expect(groups[0].clusters.map((c) => c.id)).toEqual(['loud']);
    expect(groups[1].clusters.map((c) => c.id)).toEqual(['r-new', 'r-old']);
  });
});

describe('countTalkingPointGroups', () => {
  it('counts a thread once however many clusters it spans', () => {
    const research = thread('research');
    const entries = [
      entry({ id: 'a', dateKey: daysAgo(0), threads: [research] }),
      entry({ id: 'b', dateKey: daysAgo(2), threads: [research] }),
      entry({ id: 'c', dateKey: daysAgo(5), threads: [research] }),
      entry({ id: 'solo', dateKey: daysAgo(1) }),
    ];

    expect(countFor(entries)).toBe(2);
  });

  it('still counts a matching parent and sub-entry as one cluster', () => {
    const entries = [
      entry({ id: 'root' }),
      entry({ id: 'child', parentId: 'root' }),
    ];

    expect(countFor(entries)).toBe(1);
  });

  it('agrees with groupTalkingPointsByThread across a mixed set', () => {
    const t1 = thread('t1');
    const t2 = thread('t2');
    const entries = [
      entry({ id: 'a', dateKey: daysAgo(0), threads: [t1] }),
      entry({ id: 'b', dateKey: daysAgo(3), threads: [t1] }),
      entry({ id: 'c', dateKey: daysAgo(1), threads: [t2] }),
      entry({ id: 'd', dateKey: daysAgo(2), threads: [t1, t2] }),
      entry({ id: 'plain', dateKey: daysAgo(1) }),
      entry({ id: 'faded', importance: 5, dateKey: daysAgo(30), threads: [t2] }),
      entry({ id: 'told', dateKey: daysAgo(1), saidTo: [{ personId: ANA, at: '2026-07-24T00:00:00.000Z' }] }),
    ];

    expect(countFor(entries)).toBe(groupsFor(entries).length);
  });
});
