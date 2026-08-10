import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

/* The upgrades run once on every existing install, against real diaries. If one left its new
   fields undefined, reads like `person.aliases.map(...)` or `entry.threadIds.includes(...)` would
   throw on any row that predates the field.

   All of it is asserted from a single v1 open, because that's the only shape the fake-indexeddb
   database can take here: `db` is a module-level singleton on a fixed name, so once one test has
   migrated it to the current version, no later test in this file can stage an older one. One
   install, one upgrade run, every assertion — which is also exactly what happens in production. */

const V1_SCHEMA = {
  entries: 'id, dateKey, parentId, *tagIds, *peopleIds',
  people: 'id, name',
  tags: 'id, name',
  outbox: '++seq',
  meta: 'key',
};

describe('schema upgrades from v1', () => {
  it('backfills every field added since, and heals legacy birthdays', async () => {
    // An existing install: v1 schema, a person with none of the fields added since.
    const v1 = new Dexie('diary');
    v1.version(1).stores(V1_SCHEMA);
    await v1.open();
    await v1.table('people').add({
      id: 'p1',
      name: 'Irene',
      tagIds: [],
      notes: 'met at the climbing gym',
      checkupIntervalDays: 30,
      lastCheckupAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    // A row carrying the legacy triple-dash birthday an early build wrote; the v3 upgrade is
    // supposed to rewrite it to the canonical `--10-10`.
    await v1.table('people').add({
      id: 'p2',
      name: 'Carmen',
      birthday: '---10-10',
      tagIds: [],
      notes: '',
      checkupIntervalDays: null,
      lastCheckupAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    // An entry from before threads existed (v4).
    await v1.table('entries').add({
      id: 'e1',
      content: 'reran the benchmark',
      dateKey: '2026-07-20',
      importance: 3,
      tagIds: [],
      peopleIds: [],
      saidTo: [],
      hiddenFor: [],
      parentId: null,
      createdAt: '2026-07-20T09:00:00.000Z',
      updatedAt: '2026-07-20T09:00:00.000Z',
    });
    v1.close();

    // Re-opening through the app's schema triggers every upgrade in turn.
    const { db } = await import('./db');
    await db.open();
    const person = await db.people.get('p1');

    expect(person).toMatchObject({
      aliases: [],
      phone: null,
      email: null,
      wechatId: null,
      birthday: null,
      company: null,
      jobTitle: null,
      contactId: null,
      events: [], // v3
    });
    // ...without disturbing anything that was already there.
    expect(person).toMatchObject({
      name: 'Irene',
      notes: 'met at the climbing gym',
      checkupIntervalDays: 30,
    });

    // v3 also settles the legacy birthday format, so the read-side shim can eventually go.
    const carmen = await db.people.get('p2');
    expect(carmen?.birthday).toBe('--10-10');
    expect(carmen?.events).toEqual([]);

    // v4: an entry left with `threadIds: undefined` would throw on every talking-point scan.
    const entry = await db.entries.get('e1');
    expect(entry?.threadIds).toEqual([]);
    expect(entry?.content).toBe('reran the benchmark');

    // The new indexes must be queryable, or the lookups built on them silently return nothing:
    // `aliases` backs @mention autocomplete, `threadIds` backs getThreadEntries and deleteThread.
    await db.people.update('p1', { aliases: ['Ire'] });
    const byAlias = await db.people.where('aliases').equals('Ire').toArray();
    expect(byAlias.map((p) => p.id)).toEqual(['p1']);

    await db.entries.update('e1', { threadIds: ['t1'] });
    const byThread = await db.entries.where('threadIds').equals('t1').toArray();
    expect(byThread.map((e) => e.id)).toEqual(['e1']);

    // v6: the plugin table exists and is empty. It needs no upgrade for exactly that reason —
    // there is nothing in a v1 database to backfill it from — so what's worth asserting is that
    // the v1 rows above survived a version bump that touched a table they know nothing about.
    expect(await db.pluginRecords.count()).toBe(0);
    expect(await db.entries.count()).toBe(1);
    expect(await db.people.count()).toBe(2);

    db.close();
  });
});

/* The plugin table's indexes, asserted because one of them cannot be trusted to work by inspection.
   IndexedDB has no null key, and a compound index requires *every* keypath to hold a valid one — so
   a row storing `dateKey: null` for "not about a day" would vanish from `[pluginId+dateKey]` while
   sitting in plain sight in the table. That is why undated rows carry `''`, and this is the test
   that says so. */
describe('plugin record indexes', () => {
  const record = (patch: Record<string, unknown>) => ({
    pluginId: 'habits',
    scope: 'record' as const,
    dateKey: '',
    data: {},
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...patch,
  });

  it('finds dated, undated and config rows through the index each one is read by', async () => {
    const { db } = await import('./db');
    await db.open();
    await db.pluginRecords.bulkPut([
      record({ id: 'r1', dateKey: '2026-08-01', data: { water: true } }),
      record({ id: 'r2', dateKey: '2026-08-02' }),
      // A habit *definition*: real data, but not about any particular day.
      record({ id: 'd1' }),
      // The plugin's synced config — enablement and settings.
      record({ id: 'c1', scope: 'config', data: { enabled: true } }),
      record({ id: 'other', pluginId: 'mood', dateKey: '2026-08-01' }),
    ]);

    const day = await db.pluginRecords.where('[pluginId+dateKey]').equals(['habits', '2026-08-01']);
    expect((await day.toArray()).map((r) => r.id)).toEqual(['r1']);

    // The undated rows — reachable only because dateKey is '' and not null.
    const undated = await db.pluginRecords.where('[pluginId+dateKey]').equals(['habits', '']);
    expect((await undated.toArray()).map((r) => r.id).sort()).toEqual(['c1', 'd1']);

    // The boot-path query: every plugin's config in one read, without a lookup per plugin.
    const configs = await db.pluginRecords.where('scope').equals('config').toArray();
    expect(configs.map((r) => r.id)).toEqual(['c1']);

    // A plugin's own rows, without matching another plugin's.
    const mine = await db.pluginRecords.where('[pluginId+scope]').equals(['habits', 'record']);
    expect((await mine.toArray()).map((r) => r.id).sort()).toEqual(['d1', 'r1', 'r2']);

    await db.pluginRecords.clear();
    db.close();
  });
});
