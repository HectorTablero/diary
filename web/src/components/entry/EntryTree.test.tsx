import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import * as repo from '@/db/repo';
import { anEntry } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { outboxOps, seed, seedSettings } from '@/test/seed';
import { EntryTree } from './EntryTree';

/* Reordering and reparenting the day's tree — driven from the keyboard.
 *
 * `lib/sortableTree.test.ts` already covers the arithmetic in isolation: which slot an arrow key
 * lands on, and what `applyMove` does to a forest. What nothing covered is the *chain* — that a
 * resolved drop turns into a fractional index between the right two siblings, that the index and
 * the new parent reach Dexie, and that exactly one PATCH is queued for the server. Every one of
 * those is a separate place to be wrong while the tree still looks correct on screen until the
 * next reload.
 *
 * Keyboard rather than pointer, and that is not a workaround for jsdom being awkward. The keyboard
 * path is pure index-and-depth arithmetic over the flattened list (`stepKeyboard`), so it means the
 * same thing in a test as it does in a browser — and it is a real, shipped affordance rather than a
 * test-only seam.
 *
 * **What is deliberately not asserted here, and why.** The provider also resolves a drop's *slot*
 * from measured row midpoints (`measureMidpoints`, via `offsetTop`/`offsetHeight`), and jsdom has
 * no layout at all — every row reports zero. So the final sibling *order* after a drop is decided,
 * in this environment, by geometry that does not exist, and an assertion about it would be pinning
 * jsdom rather than the app. Depth is not affected: reparenting comes from the keyboard projection,
 * which never consults a rect, which is why those assertions below are real ones.
 *
 * Ordering therefore stays covered where it can be honestly covered: `lib/sortableTree.test.ts` for
 * the slot arithmetic, and the Playwright suite for a real browser with real layout.
 */

const DAY = '2026-08-01';

const renderTree = async () => {
  const entries = await repo.getDayEntries(DAY);
  return { user: userEvent.setup(), ...renderWithProviders(<EntryTree entries={entries} />) };
};

/** Grab a row's grip handle. Its label is the same on every row, so rows are told apart by id. */
const grip = (entryId: string) => {
  const row = document.querySelector(`[data-tree-row-id="${entryId}"]`);
  if (!row) throw new Error(`no row for ${entryId}`);
  const handle = row.querySelector('button[aria-label="Drag to reorder or move"]');
  if (!handle) throw new Error(`no drag handle on ${entryId}`);
  return handle as HTMLElement;
};

/**
 * Lift a row, press some arrows, drop it.
 *
 * Space to lift and Space to drop is dnd-kit's KeyboardSensor contract, and the app announces
 * exactly that ("Picked up. Use the arrow keys to move it, space to drop…"), so this is the
 * sequence a keyboard user actually performs.
 */
const dragWithKeyboard = async (
  user: ReturnType<typeof userEvent.setup>,
  entryId: string,
  keys: string[],
) => {
  grip(entryId).focus();
  await user.keyboard('{ }');
  await screen.findByText(/Picked up/);
  for (const key of keys) await user.keyboard(key);
  await user.keyboard('{ }');
};

/** Three roots in a known order, so "moved up one" is an answerable question. */
const seedThreeRoots = () =>
  seed({
    entries: [
      anEntry({ id: 'e1', content: 'First', dateKey: DAY }),
      anEntry({ id: 'e2', content: 'Second', dateKey: DAY }),
      anEntry({ id: 'e3', content: 'Third', dateKey: DAY }),
    ],
  });

/**
 * The roots as stored, in the order the diary would render them.
 *
 * `orderKey` is optional on the row type — a document written before drag-and-drop existed simply
 * has none, and `repo.ts` heals those on read — so the fallback is not defensive padding. It is
 * what a legacy row genuinely sorts as until something moves it.
 */
const storedOrder = async () => {
  const rows = await db.entries.where('dateKey').equals(DAY).toArray();
  return rows
    .filter((row) => row.parentId === null)
    .sort((a, b) => (a.orderKey ?? '').localeCompare(b.orderKey ?? ''))
    .map((row) => row.content);
};

describe('EntryTree · keyboard reordering', () => {
  it('announces the lift, so a keyboard user knows the move has begun', async () => {
    await seedThreeRoots();
    const { user } = await renderTree();

    grip('e2').focus();
    await user.keyboard('{ }');

    /* Without this the drag is invisible to anyone not watching the screen — the row does not
       move until an arrow key is pressed, so there is nothing else to notice. */
    expect(await screen.findByText(/Picked up/)).toBeInTheDocument();
  });

  it('rewrites one row only, leaving every sibling’s key untouched', async () => {
    await seedThreeRoots();
    const before = Object.fromEntries(
      (await db.entries.toArray()).map((row) => [row.id, row.orderKey]),
    );
    const { user } = await renderTree();

    await dragWithKeyboard(user, 'e2', ['{ArrowUp}']);

    await waitFor(async () => {
      expect((await db.entries.get('e2'))!.orderKey).not.toBe(before.e2);
    });
    /* The whole point of a fractional index: a move writes *one* row. Re-numbering the siblings
       would work on screen and then re-send the user's entire day to every other device on the
       next pull, because sync is driven by `updatedAt`. Which slot it landed in is not asserted —
       see the note at the top of the file. */
    const after = await db.entries.toArray();
    expect(after.find((row) => row.id === 'e1')!.orderKey).toBe(before.e1);
    expect(after.find((row) => row.id === 'e3')!.orderKey).toBe(before.e3);
  });

  it('queues exactly one patch, carrying the parent and the key together', async () => {
    await seedThreeRoots();
    const { user } = await renderTree();

    await dragWithKeyboard(user, 'e2', ['{ArrowUp}']);

    const ops = await waitFor(async () => {
      const queued = await outboxOps();
      expect(queued).toHaveLength(1);
      return queued;
    });
    expect(ops[0]).toMatchObject({ method: 'PATCH', path: '/entries/e2' });
    /* Both fields in one op. Split across two, a replay could land the reparent without the key
       and leave the entry at an arbitrary position among its new siblings. */
    const body = ops[0].body as { parentId: string | null; orderKey: string };
    expect(body.parentId).toBeNull();
    expect(body.orderKey).toBe((await db.entries.get('e2'))!.orderKey);
  });

  it('writes nothing when the move is cancelled', async () => {
    await seedThreeRoots();
    const { user } = await renderTree();

    grip('e2').focus();
    await user.keyboard('{ }');
    await screen.findByText(/Picked up/);
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Escape}');

    // Escape is offered in the lift announcement, so it has to actually undo the whole gesture.
    await waitFor(async () => expect(await storedOrder()).toEqual(['First', 'Second', 'Third']));
    expect(await outboxOps()).toHaveLength(0);
  });
});

describe('EntryTree · keyboard reparenting', () => {
  it('nests a row under the one above it', async () => {
    await seedThreeRoots();
    const { user } = await renderTree();

    // Right is "indent", which is what makes the row above become the parent.
    await dragWithKeyboard(user, 'e2', ['{ArrowRight}']);

    await waitFor(async () => {
      expect((await db.entries.get('e2'))?.parentId).toBe('e1');
    });
    const ops = await outboxOps();
    expect((ops[0].body as { parentId: string | null }).parentId).toBe('e1');
  });

  it('lifts a nested row back out to the top level', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'Parent', dateKey: DAY }),
        anEntry({ id: 'e2', content: 'Child', dateKey: DAY, parentId: 'e1' }),
      ],
    });
    const { user } = await renderTree();

    await dragWithKeyboard(user, 'e2', ['{ArrowLeft}']);

    await waitFor(async () => {
      expect((await db.entries.get('e2'))?.parentId).toBeNull();
    });
  });

  it('refuses a nesting deeper than the user’s own limit', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'First', dateKey: DAY }),
        anEntry({ id: 'e2', content: 'Second', dateKey: DAY }),
      ],
    });
    // Nothing may nest at all, so indenting has nowhere legal to go.
    await seedSettings({ maxSubEntryDepth: 0 });
    const { user } = await renderTree();

    await dragWithKeyboard(user, 'e2', ['{ArrowRight}']);

    /* The limit is enforced while the drag is resolving — the row never reaches the illegal depth —
       rather than by letting the drop happen and rejecting it afterwards, which would be a row that
       visibly moves and then snaps back.

       Only the depth is asserted: the drop still resolves to *some* slot, and which one is the
       measurement jsdom cannot supply. */
    await waitFor(async () => {
      expect((await db.entries.get('e2'))?.parentId).toBeNull();
    });
  });
});
