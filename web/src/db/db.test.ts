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

    db.close();
  });
});
