import 'fake-indexeddb/auto';
import { DEFAULT_SETTINGS } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* What the read layer answers, not how it gets there.

   Every read in repo.ts was rewritten to stop pulling whole tables into memory — index ranges
   instead of scan-then-filter, `.each()` instead of `toArray()`, index counts instead of tallying
   every row, and a cache in front of the three lookup tables. None of that was supposed to change a
   single result, so these tests assert results: the same entries, the same counts, the same order,
   for fixtures built to catch the ways each rewrite could quietly disagree with the code it
   replaced. */

/* repo.ts reaches outbox.ts (via the lazy orderKey healer), which pulls in the notification
   reconciler and the sync engine. Neither has anything to do with reading.

   `onReconnected` is stubbed as well as `kick` because i18n/index.ts subscribes to it at module
   scope to expire its language-availability refusals, and outbox.ts now reaches i18n through
   telemetry → preferences → dates. A module mock replaces the module wholesale, so an export it
   omits is a hard error rather than an undefined — which is the right behaviour, and the reason
   this list has to name everything the graph actually uses. */
vi.mock('@/lib/notifications', () => ({ refreshNotifications: () => {} }));
vi.mock('./sync', () => ({ kick: () => {}, onReconnected: () => () => {} }));

const { db, bumpLookupVersion, setMeta } = await import('./db');
const repo = await import('./repo');
const { enqueue } = await import('./outbox');

const entry = (patch: {
  id: string;
  dateKey: string;
  content?: string;
  importance?: number;
  tagIds?: string[];
  peopleIds?: string[];
  threadIds?: string[];
  parentId?: string | null;
  saidTo?: { personId: string; at: string }[];
}) => ({
  content: 'called Carmen about the trip',
  importance: 3,
  tagIds: [],
  peopleIds: [],
  threadIds: [],
  saidTo: [],
  hiddenFor: [],
  parentId: null,
  orderKey: 'a0',
  createdAt: `${patch.dateKey}T09:00:00.000Z`,
  updatedAt: `${patch.dateKey}T09:00:00.000Z`,
  ...patch,
});

const person = (id: string, name: string, tagIds: string[] = []) => ({
  id,
  name,
  aliases: [],
  phone: null,
  email: null,
  wechatId: null,
  birthday: null,
  company: null,
  jobTitle: null,
  contactId: null,
  events: [],
  tagIds,
  notes: '',
  checkupIntervalDays: null,
  lastCheckupAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2020-01-01T00:00:00.000Z',
});

/** Today, as the fixtures below assume it. Anything scored has to sit inside the scoring window,
    which DEFAULT_SETTINGS puts a few months back, so the dates are relative rather than literal. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  await Promise.all([
    db.entries.clear(),
    db.people.clear(),
    db.tags.clear(),
    db.threads.clear(),
    db.outbox.clear(),
    db.meta.clear(),
  ]);
  bumpLookupVersion(); // the tables just changed under repo.ts's cached maps
  await setMeta('settings', DEFAULT_SETTINGS);
});

/* Was: read every entry written before today, keep the ones whose dateKey ends in "-MM-DD".
   Now: ask the dateKey index for `${year}-MM-DD` once per year, newest first, stopping at 20. */
describe('getOnThisDay', () => {
  it('finds the same day in earlier years and skips the years without one', async () => {
    await db.entries.bulkAdd([
      entry({ id: 'a', dateKey: '2023-08-08', importance: 1 }),
      entry({ id: 'b', dateKey: '2025-08-08', importance: 1 }),
      entry({ id: 'gap', dateKey: '2024-03-01', importance: 1 }), // 2024 has no 08-08
      entry({ id: 'today', dateKey: '2026-08-08', importance: 1 }),
      entry({ id: 'near', dateKey: '2025-08-09', importance: 1 }), // one day off
    ]);

    const found = await repo.getOnThisDay('2026-08-08');

    // Newest first, today excluded, neighbouring days excluded.
    expect(found.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('honours the memory importance threshold', async () => {
    await db.entries.bulkAdd([
      entry({ id: 'big', dateKey: '2025-08-08', importance: 1 }),
      entry({ id: 'small', dateKey: '2025-08-08', importance: 5 }),
    ]);

    const found = await repo.getOnThisDay('2026-08-08');

    expect(found.map((e) => e.id)).toEqual(['big']);
  });

  it('asks for 29 February without tripping over the years that lack one', async () => {
    // The per-year loop builds "2025-02-29", which simply matches nothing. No special case needed —
    // this test exists to keep it that way.
    await db.entries.bulkAdd([
      entry({ id: 'leap', dateKey: '2024-02-29', importance: 1 }),
      entry({ id: 'other', dateKey: '2025-02-28', importance: 1 }),
    ]);

    const found = await repo.getOnThisDay('2028-02-29');

    expect(found.map((e) => e.id)).toEqual(['leap']);
  });

  it('returns nothing on an empty diary rather than reading from an absent first row', async () => {
    expect(await repo.getOnThisDay('2026-08-08')).toEqual([]);
  });
});

/* search() now picks an index to prefilter with — a date range, else peopleIds, else tagIds — and
   still applies every predicate in JS. The prefilter must never change the answer, only the
   reading. The multi-entry ones are where that is easiest to get wrong. */
describe('search', () => {
  const run = (query: string) => repo.search(new URLSearchParams(query));

  beforeEach(async () => {
    await db.tags.bulkAdd([
      { id: 't1', name: 'travel', color: '#111111' },
      { id: 't2', name: 'work', color: '#222222' },
    ]);
    await db.people.bulkAdd([person('p1', 'Carmen'), person('p2', 'Diego')]);
    await db.entries.bulkAdd([
      entry({ id: 'both', dateKey: '2026-03-01', tagIds: ['t1', 't2'], content: 'lisbon trip' }),
      entry({ id: 'one', dateKey: '2026-03-02', tagIds: ['t1'], content: 'porto' }),
      entry({ id: 'none', dateKey: '2026-03-03', content: 'nothing tagged' }),
      entry({ id: 'p1a', dateKey: '2026-04-01', peopleIds: ['p1'] }),
      entry({ id: 'p1b', dateKey: '2026-04-02', peopleIds: ['p1', 'p2'] }),
    ]);
  });

  it('returns an entry once even when two of its tags were queried', async () => {
    /* The regression the `.distinct()` exists for: `where('tagIds').anyOf(['t1','t2'])` yields
       'both' once per matching tag, so without it the entry appears twice and `total` says 3. */
    const res = await run('tags=t1,t2');

    expect(res.results.map((e) => e.id)).toEqual(['one', 'both']);
    expect(res.total).toBe(2);
  });

  it('returns an entry once when two of the queried people are on it', async () => {
    const res = await run('people=p1,p2');

    expect(res.results.map((e) => e.id)).toEqual(['p1b', 'p1a']);
    expect(res.total).toBe(2);
  });

  it('agrees with itself whichever index the filters happen to select', async () => {
    // Same answer three ways: date range drives it, then peopleIds, then neither (text only).
    const byRange = await run('from=2026-04-01&to=2026-04-02&people=p1');
    const byPerson = await run('people=p1');
    expect(byRange.results.map((e) => e.id)).toEqual(byPerson.results.map((e) => e.id));

    const byText = await run('q=lisbon');
    expect(byText.results.map((e) => e.id)).toEqual(['both']);
  });

  it('applies a half-open range from either end', async () => {
    expect((await run('from=2026-04-01')).results.map((e) => e.id)).toEqual(['p1b', 'p1a']);
    expect((await run('to=2026-03-01')).results.map((e) => e.id)).toEqual(['both']);
  });

  it('still narrows by importance and text on top of the chosen index', async () => {
    const res = await run('tags=t1&q=porto');

    expect(res.results.map((e) => e.id)).toEqual(['one']);
    expect(res.total).toBe(1);
  });

  it('paginates over the full match set, not the page', async () => {
    const res = await run('limit=1&page=2');

    expect(res.total).toBe(5);
    expect(res.results).toHaveLength(1);
  });
});

/* Counts that used to come from one pass over every entry now come from the *tagIds / *threadIds
   indexes, one query per tag or thread. Same numbers, same ordering rule. */
describe('getTags / getThreads', () => {
  it('counts a tag once per entry and once per person', async () => {
    await db.tags.bulkAdd([
      { id: 't1', name: 'travel', color: '#111111' },
      { id: 't2', name: 'work', color: '#222222' },
      { id: 't3', name: 'unused', color: '#333333' },
    ]);
    await db.people.bulkAdd([person('p1', 'Carmen', ['t1']), person('p2', 'Diego', ['t1', 't2'])]);
    await db.entries.bulkAdd([
      entry({ id: 'a', dateKey: '2026-03-01', tagIds: ['t1', 't2'] }),
      entry({ id: 'b', dateKey: '2026-03-02', tagIds: ['t1'] }),
    ]);

    const tags = await repo.getTags();

    // Alphabetical, and a tag on nothing still appears with zeroes.
    expect(tags.map((t) => [t.name, t.entryCount, t.personCount])).toEqual([
      ['travel', 2, 2],
      ['unused', 0, 0],
      ['work', 1, 1],
    ]);
  });

  it('ranks threads by their newest entry, not by their own timestamp', async () => {
    await db.threads.bulkAdd([
      {
        id: 'x',
        name: 'flat hunt',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'y',
        name: 'thesis',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'z',
        name: 'empty',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ]);
    await db.entries.bulkAdd([
      entry({ id: 'a', dateKey: '2026-03-01', threadIds: ['x'] }),
      entry({ id: 'b', dateKey: '2026-05-01', threadIds: ['x'] }),
      entry({ id: 'c', dateKey: '2026-04-01', threadIds: ['y'] }),
    ]);

    const threads = await repo.getThreads();

    /* Ranked by newest entry, descending: 'empty' has none and falls back to its creation day
       (06-01), which beats 'flat hunt' (05-01) and 'thesis' (04-01). A brand new thread sitting at
       the top is the intended behaviour — that ordering rule is why the per-thread read has to
       track a max dateKey rather than just count. */
    expect(threads.map((t) => [t.name, t.entryCount])).toEqual([
      ['empty', 0],
      ['flat hunt', 2],
      ['thesis', 1],
    ]);
  });
});

/* The badge count moved out of getPeople (which every screen mounts) into its own read. The
   numbers have to be the ones getPeople used to attach. */
describe('getTalkingPointCounts', () => {
  it('counts a matching parent and its matching children as one thing to bring up', async () => {
    await db.people.bulkAdd([person('p1', 'Carmen'), person('p2', 'Diego')]);
    await db.entries.bulkAdd([
      entry({ id: 'root', dateKey: daysAgo(3), peopleIds: ['p1'], importance: 1 }),
      entry({ id: 'kid', dateKey: daysAgo(3), peopleIds: ['p1'], importance: 1, parentId: 'root' }),
      entry({ id: 'solo', dateKey: daysAgo(2), peopleIds: ['p1'], importance: 1 }),
    ]);

    const counts = await repo.getTalkingPointCounts();

    expect(counts.p1).toBe(2); // the root cluster plus the standalone entry
    expect(counts.p2).toBe(0); // nobody is silently missing from the map
  });

  it('ignores what has already been said and what is out of the scoring window', async () => {
    await db.people.bulkAdd([person('p1', 'Carmen')]);
    await db.entries.bulkAdd([
      entry({
        id: 'told',
        dateKey: daysAgo(2),
        peopleIds: ['p1'],
        importance: 1,
        saidTo: [{ personId: 'p1', at: '2026-08-01T00:00:00.000Z' }],
      }),
      // Comfortably outside the window DEFAULT_SETTINGS produces, so the index range excludes it.
      entry({ id: 'ancient', dateKey: '2019-01-01', peopleIds: ['p1'], importance: 1 }),
    ]);

    expect((await repo.getTalkingPointCounts()).p1).toBe(0);
  });

  it('caps at the configured limit', async () => {
    await setMeta('settings', { ...DEFAULT_SETTINGS, talkingPointsLimit: 2 });
    await db.people.bulkAdd([person('p1', 'Carmen')]);
    await db.entries.bulkAdd(
      Array.from({ length: 5 }, (_, i) =>
        entry({ id: `e${i}`, dateKey: daysAgo(i + 1), peopleIds: ['p1'], importance: 1 }),
      ),
    );

    expect((await repo.getTalkingPointCounts()).p1).toBe(2);
  });

  it('is no longer part of the people list', async () => {
    await db.people.bulkAdd([person('p1', 'Carmen')]);
    await db.entries.bulkAdd([entry({ id: 'a', dateKey: daysAgo(1), peopleIds: ['p1'] })]);

    const people = await repo.getPeople();

    expect(people.map((p) => p.name)).toEqual(['Carmen']);
    expect(people[0]).not.toHaveProperty('talkingPointCount');
  });
});

/* The lookup tables are cached until something writes to them, and the bump lives in outbox.enqueue
   — the one step a local write cannot skip. If that link ever breaks, a rename goes on showing its
   old value for the rest of the session, which is exactly what this test is here to catch. */
describe('joinMaps caching', () => {
  it('shows a renamed tag on the very next read', async () => {
    await db.tags.add({ id: 't1', name: 'travel', color: '#111111' });
    await db.entries.add(entry({ id: 'a', dateKey: '2026-03-01', tagIds: ['t1'] }));
    bumpLookupVersion();

    const before = await repo.getDayEntries('2026-03-01');
    expect(before[0].tags[0].name).toBe('travel');

    // Exactly what mutations.renameTag does: write locally, then queue the op for the server.
    await db.tags.put({ id: 't1', name: 'voyages', color: '#111111' });
    await enqueue('PATCH', '/tags/t1', { name: 'voyages' });

    const after = await repo.getDayEntries('2026-03-01');
    expect(after[0].tags[0].name).toBe('voyages');
  });

  it('leaves the cache alone for an entry write, which cannot affect it', async () => {
    await db.people.add(person('p1', 'Carmen'));
    bumpLookupVersion();
    await repo.getPeople(); // populate

    await enqueue('POST', '/entries', { id: 'new' });

    // Nothing to assert about staleness here — the point is that this path doesn't pay for a
    // re-read. What must still hold is that the answer is right.
    expect((await repo.getPeople()).map((p) => p.name)).toEqual(['Carmen']);
  });
});
