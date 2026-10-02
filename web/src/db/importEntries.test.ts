import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryBackupRow } from '@/lib/backup/schema';

/* The order a restore queues its entries in.

   The server refuses a sub-entry whose parent does not exist yet, and a restore tolerates a 404 on
   purpose (a backup can legitimately reference things since deleted) — so an entry queued ahead of
   its parent was not merely slow, it was silently never saved, along with anything hanging off it.
   File order does not guarantee parents first; this ordering does. */

vi.mock('@/db/sync', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  kick: () => {},
}));
vi.mock('@/lib/notifications', () => ({ refreshNotifications: () => {} }));

const { db } = await import('./db');
const { importEntries } = await import('./mutations');

const hex = (n: number) => n.toString(16).padStart(24, '0');

const row = (n: number, parent: number | null): EntryBackupRow => ({
  id: hex(n),
  content: `entry ${n}`,
  dateKey: '2026-10-02',
  importance: 3,
  tagIds: [],
  peopleIds: [],
  threadIds: [],
  saidTo: [],
  hiddenFor: [],
  parentId: parent === null ? null : hex(parent),
  orderKey: 'a0',
  createdAt: '2026-10-02T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
});

const create = (r: EntryBackupRow) => ({ row: r, resolution: { action: 'create' as const } });

beforeEach(async () => {
  await db.entries.clear();
});

/** Each POST's content and parent, in queue order, with parents named by content too. */
const queued = (ops: Awaited<ReturnType<typeof importEntries>>['ops']) => {
  const posts = ops
    .filter((op) => op.method === 'POST')
    .map((op) => op.body as { id: string; content: string; parentId: string | null });
  const contentById = new Map(posts.map((p) => [p.id, p.content]));
  return posts.map((p) => ({
    content: p.content,
    parent: p.parentId === null ? null : (contentById.get(p.parentId) ?? 'existing'),
  }));
};

describe('importEntries: queue order', () => {
  it('queues a parent before a child the file lists first, at every depth', async () => {
    // Grandchild, child, parent — exactly backwards.
    const { ops } = await importEntries(
      [create(row(3, 2)), create(row(2, 1)), create(row(1, null))],
      new Map(),
      new Map(),
      new Map(),
    );

    expect(queued(ops)).toEqual([
      { content: 'entry 1', parent: null },
      { content: 'entry 2', parent: 'entry 1' },
      { content: 'entry 3', parent: 'entry 2' },
    ]);
  });

  it('keeps file order among rows that do not depend on each other', async () => {
    const { ops } = await importEntries(
      [create(row(1, null)), create(row(5, 1)), create(row(2, null)), create(row(6, 2))],
      new Map(),
      new Map(),
      new Map(),
    );

    // A stable sort: roots in file order, then their children in file order.
    expect(queued(ops).map((q) => q.content)).toEqual(['entry 1', 'entry 2', 'entry 5', 'entry 6']);
  });

  it('leaves a child of an entry already here where it was', async () => {
    await db.entries.put({ ...row(9, null), id: hex(9) } as never);

    const { ops } = await importEntries(
      [create(row(4, 9)), create(row(1, null))],
      new Map(),
      new Map(),
      new Map(),
    );

    // Its parent is not part of this import, so there is nothing for it to wait behind.
    expect(queued(ops)).toEqual([
      { content: 'entry 4', parent: 'existing' },
      { content: 'entry 1', parent: null },
    ]);
  });

  it('does not hang on a cycle in a damaged file', async () => {
    const { ops } = await importEntries(
      [create(row(1, 2)), create(row(2, 1))],
      new Map(),
      new Map(),
      new Map(),
    );

    expect(ops.filter((op) => op.method === 'POST')).toHaveLength(2);
  });
});
