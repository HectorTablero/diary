import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

/* The v1 -> v2 upgrade runs once on every existing install, against real diaries. If it left the
   new fields undefined, reads like `person.aliases.map(...)` would throw on any person who
   existed before the contact metadata landed. */

const V1_SCHEMA = {
  entries: 'id, dateKey, parentId, *tagIds, *peopleIds',
  people: 'id, name',
  tags: 'id, name',
  outbox: '++seq',
  meta: 'key',
};

describe('people store v2 upgrade', () => {
  it('backfills contact metadata onto people written by v1', async () => {
    // An existing install: v1 schema, a person with none of the new fields.
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
    v1.close();

    // Re-opening through the app's schema triggers the upgrade.
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
    });
    // ...without disturbing anything that was already there.
    expect(person).toMatchObject({
      name: 'Irene',
      notes: 'met at the climbing gym',
      checkupIntervalDays: 30,
    });

    // The new alias index must be queryable, or @mention lookups silently return nothing.
    await db.people.update('p1', { aliases: ['Ire'] });
    const byAlias = await db.people.where('aliases').equals('Ire').toArray();
    expect(byAlias.map((p) => p.id)).toEqual(['p1']);

    db.close();
  });
});
