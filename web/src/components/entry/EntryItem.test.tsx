import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import * as repo from '@/db/repo';
import { anEntry, aPerson, aTag, aThread } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { outboxOps, seed, seedSettings } from '@/test/seed';
import { EntryItem } from './EntryItem';

/* One row of the diary, and everything that can be done to it.
 *
 * The row is handed a real `EntryNode` read back out of the store through `repo.getDayEntries`,
 * rather than a hand-built object. That is not ceremony: an EntryNode is the *output* of the join
 * maps and the tree builder, and a literal written here would let the test disagree with what the
 * repo actually produces — chips resolved from ids, `children` populated, `orderKey` healed — while
 * still passing. Building it through the repo means the fixture and the component agree because
 * they went through the same code, not because they were typed to match.
 *
 * Rendered without a SortableTreeProvider above it, which is deliberate. `useSortableTreeRow`
 * tolerates a missing context (dnd-kit's own `useDraggable` has a default), and every assertion
 * here is about the row's *actions*, none of which involve dragging. EntryTree owns the drag half.
 */

const DAY = '2026-08-01';

/** Read the tree back the way the page does, then hand a root row to the component. */
async function rowFor(entryId: string) {
  const roots = await repo.getDayEntries(DAY);
  const node = roots.find((entry) => entry.id === entryId);
  if (!node) throw new Error(`no root entry ${entryId} in the seeded day`);
  return node;
}

const renderRow = async (entryId: string) => {
  const entry = await rowFor(entryId);
  return { user: userEvent.setup(), ...renderWithProviders(<EntryItem entry={entry} />) };
};

/**
 * The queued ops, once the mutation has finished queueing them.
 *
 * Waiting on the *outbox* rather than reading it after waiting on Dexie, which is a real race and
 * not a theoretical one: every mutation in db/mutations.ts writes its table first and calls
 * `enqueue` afterwards, so a `waitFor` polling `db.entries` is satisfied in the window between the
 * two and the read that follows finds an empty queue.
 */
const queuedOps = (expected: number) =>
  waitFor(async () => {
    const ops = await outboxOps();
    expect(ops).toHaveLength(expected);
    return ops;
  });

/** EntryContent splits its text into one element per segment, so match the paragraph as a whole. */
const entryText = (text: string) =>
  screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === text);

/**
 * The ⋯ menu of one particular row, opened.
 *
 * Named by its entry rather than found by position, because a row renders its children as rows
 * too — so a tree of three has three ⋯ buttons and a positional match would silently start
 * asserting about a sub-entry. That the label carries the entry's own text is exactly what makes
 * this possible, and is the same thing a screen-reader user relies on to tell them apart.
 */
const openActions = async (user: ReturnType<typeof userEvent.setup>, content: string) => {
  await user.click(screen.getByRole('button', { name: `Actions for “${content}”` }));
  return screen.findByRole('menu');
};

describe('EntryItem', () => {
  it('renders its own text and nests its children under it', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'Ran into Ana', dateKey: DAY }),
        anEntry({ id: 'e2', content: 'She has a new job', dateKey: DAY, parentId: 'e1' }),
      ],
    });

    await renderRow('e1');

    expect(await entryText('Ran into Ana')).toBeInTheDocument();
    // Sub-entries start open, following the `entriesExpanded` preference's default.
    expect(await entryText('She has a new job')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 sub-entry' })).toBeInTheDocument();
  });

  it('collapses and reopens its children, without touching anything stored', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'Ran into Ana', dateKey: DAY }),
        anEntry({ id: 'e2', content: 'She has a new job', dateKey: DAY, parentId: 'e1' }),
      ],
    });
    const { user } = await renderRow('e1');

    await user.click(screen.getByRole('button', { name: '1 sub-entry' }));

    await waitFor(() => expect(screen.queryByText('She has a new job')).not.toBeInTheDocument());
    /* Collapsing is per-entry and per-visit by design — the preference decides only where a row
     *starts*. So this must not have written anything, least of all queued an op. */
    expect(await outboxOps()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: '1 sub-entry' }));
    expect(await entryText('She has a new job')).toBeInTheDocument();
  });

  it('shows a chip only for a link the text does not already carry', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    const ana = aPerson({ id: 'p1', name: 'Ana' });
    const jobHunt = aThread({ id: 'th1', name: 'Job hunt' });
    await seed({
      tags: [work],
      people: [ana],
      threads: [jobHunt],
      entries: [
        anEntry({
          id: 'e1',
          // @Ana is written inline; #work is linked but never mentioned.
          content: 'Coffee with @Ana',
          dateKey: DAY,
          tags: [work],
          people: [{ id: ana.id, name: ana.name }],
          threads: [jobHunt],
        }),
      ],
    });

    await renderRow('e1');

    await entryText('Coffee with @Ana');
    /* The rule the chip row exists to implement: a chip repeating a token already in the sentence
       is noise, so only the unmentioned tag earns one. Ana appears exactly once — as the inline
       mention — and not again beside it. */
    expect(screen.getAllByText('@Ana')).toHaveLength(1);
    expect(screen.getByText('#work')).toBeInTheDocument();
    // A thread is never a token in the text, so it is always a chip — there is no inline copy.
    expect(screen.getByText('Job hunt')).toBeInTheDocument();
  });

  it('deletes on confirmation, queues the delete, and never on the first click', async () => {
    await seed({ entries: [anEntry({ id: 'e1', content: 'Booked the dentist', dateKey: DAY })] });
    const { user } = await renderRow('e1');

    const menu = await openActions(user, 'Booked the dentist');
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));

    // The confirm step is the whole safety net — a diary entry is not something to lose to a
    // mis-tap, and the undo below only lasts as long as a toast.
    expect(await screen.findByText('Delete entry?')).toBeInTheDocument();
    expect(await db.entries.count()).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(async () => expect(await db.entries.count()).toBe(0));
    const ops = await queuedOps(1);
    expect(ops[0]).toMatchObject({ method: 'DELETE', path: '/entries/e1' });
  });

  it('takes the whole subtree with it, and gives the whole subtree back', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'Ran into Ana', dateKey: DAY }),
        anEntry({ id: 'e2', content: 'She has a new job', dateKey: DAY, parentId: 'e1' }),
        anEntry({ id: 'e3', content: 'At a hospital', dateKey: DAY, parentId: 'e2' }),
      ],
    });
    const { user } = await renderRow('e1');

    const menu = await openActions(user, 'Ran into Ana');
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    /* All three, not just the row that was clicked — which is what the confirm dialog warned
       about, and what the deletion snapshot has to capture for the undo to be honest. */
    await waitFor(async () => expect(await db.entries.count()).toBe(0));

    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(async () => expect(await db.entries.count()).toBe(3));
    const restored = await db.entries.get('e3');
    // Grandchild included, and still attached where it was — a flat restore would orphan it.
    expect(restored?.parentId).toBe('e2');
  });

  it('edits in place, writing the change locally and queueing one patch', async () => {
    await seed({ entries: [anEntry({ id: 'e1', content: 'Bought milk', dateKey: DAY })] });
    const { user } = await renderRow('e1');

    const menu = await openActions(user, 'Bought milk');
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit' }));

    const box = await screen.findByPlaceholderText('What happened? Use @person and #tag…');
    await user.clear(box);
    await user.type(box, 'Bought oat milk');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      expect((await db.entries.get('e1'))?.content).toBe('Bought oat milk');
    });
    const ops = await queuedOps(1);
    expect(ops[0]).toMatchObject({ method: 'PATCH', path: '/entries/e1' });
  });

  it('adds a sub-entry under the row that offered it', async () => {
    await seed({ entries: [anEntry({ id: 'e1', content: 'Ran into Ana', dateKey: DAY })] });
    const { user } = await renderRow('e1');

    await user.click(screen.getByRole('button', { name: 'Add sub-entry' }));
    await user.type(
      await screen.findByPlaceholderText('What happened? Use @person and #tag…'),
      'She has a new job',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const child = await waitFor(async () => {
      const rows = await db.entries.where('parentId').equals('e1').toArray();
      expect(rows).toHaveLength(1);
      return rows[0];
    });
    expect(child.content).toBe('She has a new job');
    // The child inherits the parent's day rather than today's — a sub-entry belongs to the same
    // page as the thing it elaborates on, whenever it happens to be typed.
    expect(child.dateKey).toBe(DAY);
  });

  /* The user's own nesting limit, not the shared ceiling. A row at the limit must not offer a
     control that would produce something the settings forbid. */
  it('stops offering sub-entries once the user’s depth limit is reached', async () => {
    await seed({ entries: [anEntry({ id: 'e1', content: 'Ran into Ana', dateKey: DAY })] });
    await seedSettings({ maxSubEntryDepth: 0 });

    const { user } = await renderRow('e1');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Add sub-entry' })).not.toBeInTheDocument(),
    );
    const menu = await openActions(user, 'Ran into Ana');
    expect(within(menu).queryByRole('menuitem', { name: 'Add sub-entry' })).not.toBeInTheDocument();
    // Everything else still works — the limit removes one action, not the menu.
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
  });

  it('does not offer voice capture when the row was not told it could', async () => {
    await seed({ entries: [anEntry({ id: 'e1', content: 'Ran into Ana', dateKey: DAY })] });
    const { user } = await renderRow('e1');

    /* `voiceEnabled` is resolved once in EntryTree — a key to transcribe with, a live session, and
       a reachable server — so a row asked to render without it must show no mic at all rather than
       one that fails when pressed. */
    const menu = await openActions(user, 'Ran into Ana');
    expect(within(menu).queryByRole('menuitem', { name: /record/i })).not.toBeInTheDocument();
  });
});
