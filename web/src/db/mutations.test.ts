import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Renaming a person, and the prose that has to follow.
 *
 * The diary keeps `@Ana` twice over: as a structured `peopleIds` link, which a rename cannot break,
 * and as literal text inside what was written, which it can. Entries have always been rewritten;
 * plugin *documents* are the new half, and they carry a requirement entries never had — the rewrite
 * has to reach a plugin that is switched **off**. So it lives in core, keyed on nothing but "this
 * collection holds prose", and these tests are what say so: not one of them enables a plugin, and
 * the registry is never consulted. */

/* Same module stubs repo.test.ts needs, for the same reason: mutations.ts reaches outbox.ts, which
   pulls in the notification reconciler and the sync engine, neither of which has anything to do
   with rewriting text. */
vi.mock('@/lib/notifications', () => ({ refreshNotifications: () => {} }));
vi.mock('./sync', () => ({ kick: () => {}, onReconnected: () => () => {} }));

const { db } = await import('./db');
const { createPluginDocument, putDocumentRevision } = await import('./pluginDocuments');
const { createPerson, updatePerson } = await import('./mutations');

/** A person with only a name that matters. Every other field is required by the input type and
    irrelevant to a rename, so it is filled once here rather than at nine call sites. */
const makePerson = (name: string) =>
  createPerson({
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
    tags: [],
    notes: '',
  });

const doc = (body: string, title = '') =>
  createPluginDocument('notebook', { parentId: '', title, body, sortKey: 'a0' });

const bodyOf = async (id: string) => (await db.pluginDocuments.get(id))?.body;

beforeEach(async () => {
  await db.people.clear();
  await db.entries.clear();
  await db.pluginDocuments.clear();
  await db.outbox.clear();
  await db.meta.clear();
});

describe('renaming a person', () => {
  it('rewrites the mention inside a plugin document', async () => {
    const person = await makePerson('Ana');
    const written = await doc('Walking with @Ana, who thinks the opposite.');

    await updatePerson(person.id, { name: 'Ana María' });

    expect(await bodyOf(written.id)).toBe('Walking with @Ana María, who thinks the opposite.');
  });

  it('queues the rewrite so the other devices get it too', async () => {
    const person = await makePerson('Ana');
    const written = await doc('A thought about @Ana.');
    await db.outbox.clear();

    await updatePerson(person.id, { name: 'Ana María' });

    const ops = await db.outbox.toArray();
    expect(ops).toContainEqual(
      expect.objectContaining({
        method: 'PATCH',
        path: `/plugin-documents/${written.id}`,
        body: { body: 'A thought about @Ana María.' },
      }),
    );
  });

  /* The rule that keeps the sweep honest: it matches the way the composer's own resolver does,
     longest name first. Without it, renaming "Ana" would eat the first half of every "@Ana María". */
  it('leaves a longer name that merely starts with the old one alone', async () => {
    const ana = await makePerson('Ana');
    await makePerson('Ana María');
    const written = await doc('@Ana and @Ana María disagree.');

    await updatePerson(ana.id, { name: 'Anabel' });

    expect(await bodyOf(written.id)).toBe('@Anabel and @Ana María disagree.');
  });

  it('touches nothing when the document never named them', async () => {
    const person = await makePerson('Ana');
    const written = await doc('No mentions here at all.');
    const before = await db.pluginDocuments.get(written.id);

    await updatePerson(person.id, { name: 'Ana María' });

    expect(await db.pluginDocuments.get(written.id)).toEqual(before);
  });

  /* Revisions hold patches, not prose. Rewriting text inside one would corrupt the chain that
     reconstructs every earlier day — and the old name is the truth about what was written then. */
  it('never rewrites a revision', async () => {
    const person = await makePerson('Ana');
    const written = await doc('About @Ana.');
    const revision = await putDocumentRevision(
      'notebook',
      written.id,
      '2026-08-18',
      JSON.stringify([['+', ['About @Ana.']]]),
      11,
      0,
    );

    await updatePerson(person.id, { name: 'Ana María' });

    expect((await db.pluginDocuments.get(revision.id))?.body).toBe(
      JSON.stringify([['+', ['About @Ana.']]]),
    );
  });

  it('rewrites every document that named them, in one batch', async () => {
    const person = await makePerson('Ana');
    const first = await doc('@Ana, again.');
    const second = await doc('Still thinking about what @Ana said.');
    await doc('Nothing to do with anyone.');

    await updatePerson(person.id, { name: 'Ana María' });

    expect(await bodyOf(first.id)).toBe('@Ana María, again.');
    expect(await bodyOf(second.id)).toBe('Still thinking about what @Ana María said.');
  });

  it('costs nothing when there are no documents at all', async () => {
    const person = await makePerson('Ana');
    await db.outbox.clear();

    await updatePerson(person.id, { name: 'Ana María' });

    // Only the person's own PATCH: the sweep found an empty index and stopped there, which is what
    // everyone who has never opened a notebook pays for a rename.
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].path).toBe(`/people/${person.id}`);
  });

  it('does nothing when the name did not really change', async () => {
    const person = await makePerson('Ana');
    const written = await doc('About @Ana.');

    await updatePerson(person.id, { notes: 'unchanged name' });

    expect(await bodyOf(written.id)).toBe('About @Ana.');
  });
});
