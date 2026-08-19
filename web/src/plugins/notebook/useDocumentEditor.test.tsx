import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* The editor's own share of the "two devices, one document" problem.
 *
 * The sync engine merges the *row* (see db/pluginDocumentMerge.ts). What it cannot see is the text
 * that only exists in the textarea — typed since the last save, so present in neither the row nor
 * the merge — and there is a real window for it: a save settles after 800ms, and a pull can land
 * inside it. Keeping the box and discarding the row loses the other device's writing a moment
 * later, when the box is banked over it; keeping the row and discarding the box throws away the
 * half-sentence someone is in the middle of. So the box gets merged too, and this is where that is
 * pinned.
 */

const sync = vi.hoisted(() => ({ applied: new Set<() => void>() }));

vi.mock('@/db/sync', () => ({
  onSyncApplied: (cb: () => void) => {
    sync.applied.add(cb);
    return () => sync.applied.delete(cb);
  },
  kick: () => {},
}));

const { db } = await import('@/db/db');
const { createPluginDocument } = await import('@/db/pluginDocuments');
const { useDocumentEditor } = await import('./useNotebook');

/** A sync landing: the row has changed underneath the open editor. */
const serverWrote = async (id: string, body: string) => {
  await db.pluginDocuments.update(id, { body });
  await act(async () => {
    for (const listener of sync.applied) listener();
    await Promise.resolve();
  });
};

const BASE = 'Met Ana for coffee. She is moving in June.';
const OURS = 'Met Ana for coffee. She is moving in June. I should help her pack.';
const THEIRS = 'Met Ana for coffee at the market. She is moving in June.';
const MERGED = 'Met Ana for coffee at the market. She is moving in June. I should help her pack.';

const openEditor = async (body: string) => {
  const doc = await createPluginDocument('notebook', {
    parentId: '',
    title: 'A thought',
    body,
    sortKey: 'a0',
  });
  const view = renderHook(() => useDocumentEditor(doc.id));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return { doc, view };
};

beforeEach(async () => {
  sync.applied.clear();
  await Promise.all([
    db.pluginDocuments.clear(),
    db.pluginDocumentBases.clear(),
    db.outbox.clear(),
  ]);
});

describe('useDocumentEditor and a sync landing mid-sentence', () => {
  it('adopts the new text when nothing has been typed since the last save', async () => {
    const { doc, view } = await openEditor(BASE);

    await serverWrote(doc.id, THEIRS);

    expect(view.result.current.body).toBe(THEIRS);
  });

  it('merges the unsaved keystrokes with what arrived, keeping both', async () => {
    const { doc, view } = await openEditor(BASE);
    act(() => view.result.current.setBody(OURS));

    await serverWrote(doc.id, THEIRS);

    expect(view.result.current.body).toBe(MERGED);
  });

  /* The half that matters most: the merged text has to be what the *save* banks. If the pending
     text stayed as it was typed, the write a moment later would put the pre-merge version back and
     undo the whole exercise. */
  it('banks the merged text, not the text as it was typed', async () => {
    const { doc, view } = await openEditor(BASE);
    act(() => view.result.current.setBody(OURS));
    await serverWrote(doc.id, THEIRS);

    await act(async () => {
      await view.result.current.flush();
    });

    expect((await db.pluginDocuments.get(doc.id))?.body).toBe(MERGED);
  });

  it('leaves the box alone when the row did not actually move', async () => {
    const { doc, view } = await openEditor(BASE);
    act(() => view.result.current.setBody(OURS));

    // A sync that carried something else entirely; this document is untouched.
    await serverWrote(doc.id, BASE);

    expect(view.result.current.body).toBe(OURS);
  });
});
