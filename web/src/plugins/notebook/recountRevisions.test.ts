import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { putDocumentRevision } from '@/db/pluginDocuments';
import { encodePatch, diffText } from './patch';
import { recountRevisions } from './recountRevisions';

/* OBSOLETE — tests the one-off v9.8.4 repair. Remove with recountRevisions.ts from v9.8.5 onwards. */

beforeEach(async () => {
  await db.pluginDocuments.clear();
  await db.outbox.clear();
  await db.meta.clear();
});

describe('recountRevisions', () => {
  it('rewrites the counts a pre-v9.8.4 save got wrong, and only those', async () => {
    const monday = await putDocumentRevision(
      'notebook',
      'doc-1',
      '2026-08-10',
      encodePatch(diffText('', 'Line')),
      4,
      0,
    );
    // What the old counting stored for appending a line: the untouched `Line` as removed and re-added.
    const tuesday = await putDocumentRevision(
      'notebook',
      'doc-1',
      '2026-08-11',
      encodePatch(diffText('Line', 'Line\nNew')),
      8,
      4,
    );
    await db.outbox.clear();

    await recountRevisions();

    expect(await db.pluginDocuments.get(monday.id)).toMatchObject({ added: 4, removed: 0 });
    expect(await db.pluginDocuments.get(tuesday.id)).toMatchObject({
      added: 4,
      removed: 0,
      body: tuesday.body,
    });
    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      method: 'PATCH',
      path: `/plugin-documents/${tuesday.id}`,
      body: { added: 4, removed: 0 },
    });
  });

  it('runs once', async () => {
    const row = await putDocumentRevision(
      'notebook',
      'doc-1',
      '2026-08-10',
      encodePatch(diffText('', 'Line')),
      4,
      0,
    );
    await recountRevisions();
    await db.pluginDocuments.update(row.id, { added: 99 });
    await recountRevisions();
    expect(await db.pluginDocuments.get(row.id)).toMatchObject({ added: 99 });
  });
});
