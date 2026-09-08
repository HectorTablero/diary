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

/* A hook into the one read whose timing the flicker depends on. `load` fetches the row and then
   uses what came back; on a device where saves and pulls overlap, a save can land in between. Left
   to chance that interleaving happens sometimes and would make a test that fails sometimes, so the
   read is held open on demand instead — one shot, armed by the test that wants it. */
const rowRead = vi.hoisted(() => ({ hold: null as Promise<void> | null }));

vi.mock('@/db/pluginDocuments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/pluginDocuments')>();
  return {
    ...actual,
    getPluginDocument: async (id: string) => {
      // Read first, *then* hold: the point is a row that was true when it was fetched and stale by
      // the time it is used.
      const row = await actual.getPluginDocument(id);
      const held = rowRead.hold;
      rowRead.hold = null;
      if (held) await held;
      return row;
    },
  };
});

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
  rowRead.hold = null;
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

/* The other half of "one document, two writers", and the commoner one by far: there is no second
 * writer. Every save kicks a sync pass, every pass that carries anything re-runs `load`, and on a
 * slow link those passes are long and overlap the typing that caused them. Nothing here is about
 * merging — it is about a reload that has nothing to say saying nothing. */
describe('useDocumentEditor and this device being the only one writing', () => {
  it('does not put the box back when a reload reads the row mid-save', async () => {
    const { doc, view } = await openEditor(BASE);
    act(() => view.result.current.setBody(OURS));

    let release!: () => void;
    rowRead.hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    await act(async () => {
      // A pull applies, and its read of the row is held open...
      for (const listener of sync.applied) listener();
      // ...while the save it raced lands underneath it.
      await view.result.current.flush();
      // Now the read comes back, describing the document as it was before the save.
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.result.current.body).toBe(OURS);
    expect((await db.pluginDocuments.get(doc.id))?.body).toBe(OURS);
  });

  /* The row object is what the page renders the title and the size warning from. A pull that said
     nothing about this document must not hand back a new one, or every sync pass on a slow
     connection re-renders the editor around whatever is being typed. */
  it('keeps the same row object across a sync that did not touch the document', async () => {
    const { view } = await openEditor(BASE);
    const before = view.result.current.document;

    await act(async () => {
      for (const listener of sync.applied) listener();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.result.current.document).toBe(before);
    expect(view.result.current.body).toBe(BASE);
  });
});
