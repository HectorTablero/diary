import 'fake-indexeddb/auto';
import { UNDATED_KEY, type PluginRecordDto } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createPluginRecord, getUndatedRecords } from '@/db/pluginRecords';
import { restorePluginDocuments } from '@/db/pluginDocuments';
import { resolveDocumentIcons, setDocumentIcon } from './icons';
import { createDocument, deleteDocument } from './useNotebook';

/* A document's icon lives in pluginRecord, beside the document rather than on it (see icons.ts), so
   the two have to be kept in step by hand: one row per document, gone when the document goes, and
   back when Undo brings the document back. */

vi.mock('@/db/sync', () => ({ onSyncApplied: () => () => {}, kick: () => {} }));

const iconRows = async () =>
  (await getUndatedRecords('notebook')).filter((row) => row.data.kind === 'icon');

beforeEach(async () => {
  await db.pluginRecords.clear();
  await db.pluginDocuments.clear();
  await db.outbox.clear();
});

describe('document icons', () => {
  it('keeps one row per document, updated in place and removed for "no icon"', async () => {
    const doc = await createDocument('');
    await setDocumentIcon(doc.id, 'apple');
    await setDocumentIcon(doc.id, 'banana');
    expect((await iconRows()).map((row) => row.data.icon)).toEqual(['banana']);

    await setDocumentIcon(doc.id, null);
    expect(await iconRows()).toHaveLength(0);
  });

  it('reads the newest of two rows two devices wrote, and tidies the other on the next write', async () => {
    const doc = await createDocument('');
    const older = await createPluginRecord('notebook', 'record', UNDATED_KEY, {
      kind: 'icon',
      documentId: doc.id,
      icon: 'apple',
    });
    const newer: PluginRecordDto = {
      ...older,
      id: 'newer',
      data: { kind: 'icon', documentId: doc.id, icon: 'banana' },
      updatedAt: new Date(Date.parse(older.updatedAt) + 1000).toISOString(),
    };
    await db.pluginRecords.put(newer);
    expect(resolveDocumentIcons(await iconRows()).get(doc.id)).toBe('banana');

    await setDocumentIcon(doc.id, 'cherry');
    const rows = await iconRows();
    expect(rows.map((row) => [row.id, row.data.icon])).toEqual([['newer', 'cherry']]);
  });

  it('goes with its document, subtree included, and comes back with it on undo', async () => {
    const parent = await createDocument('');
    const child = await createDocument(parent.id);
    const other = await createDocument('');
    await setDocumentIcon(parent.id, 'folder');
    await setDocumentIcon(child.id, 'file');
    await setDocumentIcon(other.id, 'star');

    const { deletion } = await deleteDocument(parent.id);
    expect(resolveDocumentIcons(await iconRows())).toEqual(new Map([[other.id, 'star']]));

    await restorePluginDocuments(deletion);
    expect(resolveDocumentIcons(await iconRows())).toEqual(
      new Map([
        [parent.id, 'folder'],
        [child.id, 'file'],
        [other.id, 'star'],
      ]),
    );
  });

  it('ignores rows that are not icons, or whose icon is malformed', () => {
    const row = (data: Record<string, unknown>): PluginRecordDto => ({
      id: Math.random().toString(),
      pluginId: 'notebook',
      scope: 'record',
      dateKey: UNDATED_KEY,
      data,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(
      resolveDocumentIcons([
        row({ kind: 'other', documentId: 'a', icon: 'apple' }),
        row({ kind: 'icon', documentId: 'b', icon: 'Not An Icon' }),
      ]).size,
    ).toBe(0);
  });
});
