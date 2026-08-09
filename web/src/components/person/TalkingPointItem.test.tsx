import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TalkingPointNode } from '@diary/shared';
import * as repo from '@/db/repo';
import { anEntry, aPerson } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { outboxOps, seed } from '@/test/seed';
import { TalkingPointItem } from './TalkingPointItem';

/* The two marks that decide what the app will ever suggest you talk about — and the gap left when
 * EntryItem was covered, because neither of them lives there.
 *
 * `said` means "I've told them this", and `hidden` means "never bring this up for this person".
 * Both are per-entry *and* per-person, both are one click behind a toast, and both are wrong in a
 * way nobody notices: a mark written against the wrong entry or the wrong person just makes a
 * talking point quietly disappear, which is indistinguishable from it having decayed out of the
 * scoring window on its own.
 *
 * The node handed to the component comes out of `repo.getTalkingPoints` rather than being written
 * by hand. A `TalkingPointNode` is the *output* of the scoring forest — `matchType`, which children
 * survived, which are context — and a literal here could disagree with what the repo actually
 * produces while still passing.
 */

const TODAY = '2026-08-09';
const PERSON = 'p1';

beforeEach(() => {
  // The scoring window is measured against `Date.now()`, so an unpinned clock would make these
  // tests change meaning every day. See PeopleListPage.test.tsx for why only Date is faked.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00.000Z`) });
});

afterEach(() => vi.useRealTimers());

/** The forest the profile would render, then one root out of it. */
async function nodeFor(entryId: string): Promise<TalkingPointNode> {
  const { active } = await repo.getTalkingPoints(PERSON);
  const found = active.find((node) => node.id === entryId);
  if (!found) throw new Error(`entry ${entryId} is not an active talking point`);
  return found;
}

const renderNode = async (entryId: string) => {
  const node = await nodeFor(entryId);
  return {
    user: userEvent.setup(),
    ...renderWithProviders(<TalkingPointItem node={node} personId={PERSON} personName="Ana" />),
  };
};

/** A root that mentions Ana, plus whichever children the test wants. */
const seedTree = (children: { id: string; content: string; mentions?: boolean }[] = []) =>
  seed({
    people: [aPerson({ id: PERSON, name: 'Ana' })],
    entries: [
      anEntry({
        id: 'e1',
        content: 'Coffee with @Ana',
        dateKey: TODAY,
        people: [{ id: PERSON, name: 'Ana' }],
      }),
      ...children.map((child) =>
        anEntry({
          id: child.id,
          content: child.content,
          dateKey: TODAY,
          parentId: 'e1',
          people: child.mentions ? [{ id: PERSON, name: 'Ana' }] : [],
        }),
      ),
    ],
  });

describe('TalkingPointItem · what it shows', () => {
  it('says why the entry is being suggested at all', async () => {
    await seedTree();

    await renderNode('e1');

    /* The badge is the only thing that explains a suggestion. Without it a shared-tag match reads
       as the app having invented a connection — the entry never names the person. */
    expect(screen.getByText('Mentions them')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as said' })).toBeInTheDocument();
  });

  it('always shows a sub-entry that matched', async () => {
    await seedTree([{ id: 'e2', content: 'She has a new job', mentions: true }]);

    await renderNode('e1');

    // A matching descendant is a talking point in its own right; hiding it behind a toggle would
    // bury the thing you actually wanted to raise.
    expect(screen.getByText('She has a new job')).toBeInTheDocument();
  });

  it('collapses a branch that matched nothing, and counts it', async () => {
    await seedTree([{ id: 'e2', content: 'Paid the gas bill' }]);
    const { user } = await renderNode('e1');

    /* Context, not a talking point: it belongs to the same conversation but names nobody. Shown
       collapsed so the row stays about what there is to say. */
    expect(screen.queryByText('Paid the gas bill')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: '+1 hidden sub-entry' });

    await user.click(toggle);

    expect(await screen.findByText('Paid the gas bill')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide sub-entries' })).toBeInTheDocument();
  });

  it('offers no marks on a row that is only context', async () => {
    await seedTree([{ id: 'e2', content: 'Paid the gas bill' }]);
    const { user } = await renderNode('e1');

    await user.click(screen.getByRole('button', { name: '+1 hidden sub-entry' }));
    await screen.findByText('Paid the gas bill');

    /* One "Mark as said" on screen, belonging to the root. A non-matching row was never suggested,
       so there is nothing about it to have said — and a second button here would let someone mark
       an entry as told that the app never proposed telling. */
    expect(screen.getAllByRole('button', { name: 'Mark as said' })).toHaveLength(1);
  });
});

describe('TalkingPointItem · marking as said', () => {
  it('queues the mark against this entry and this person', async () => {
    await seedTree();
    const { user } = await renderNode('e1');

    await user.click(screen.getByRole('button', { name: 'Mark as said' }));

    const ops = await waitFor(async () => {
      const queued = await outboxOps();
      expect(queued).toHaveLength(1);
      return queued;
    });
    /* The outbox path shape matters beyond this route: sync.ts parses `entries/<id>/said/<person>`
       positionally to protect unpushed edits from being clobbered by a pull. */
    expect(ops[0]).toMatchObject({ method: 'PUT', path: `/entries/e1/said/${PERSON}` });
  });

  it('records the mark locally, so the entry stops being suggested', async () => {
    await seedTree();
    const { user } = await renderNode('e1');

    await user.click(screen.getByRole('button', { name: 'Mark as said' }));

    await waitFor(async () => {
      const { active, said } = await repo.getTalkingPoints(PERSON);
      // Moved from one list to the other — which is the whole visible effect of the button.
      expect(active).toHaveLength(0);
      expect(said.map((entry) => entry.id)).toEqual(['e1']);
    });
  });

  it('offers an Undo that queues the retraction', async () => {
    await seedTree();
    const { user } = await renderNode('e1');

    await user.click(screen.getByRole('button', { name: 'Mark as said' }));
    expect(await screen.findByText('Marked as said')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    /* A DELETE on the same path, not a rollback of the queued PUT. Both ops replay in order, and
       the server ends where the user did — which is what makes undo survive being offline. */
    await waitFor(async () => {
      const ops = await outboxOps();
      expect(ops.at(-1)).toMatchObject({ method: 'DELETE', path: `/entries/e1/said/${PERSON}` });
    });
    await waitFor(async () => {
      expect((await repo.getTalkingPoints(PERSON)).active).toHaveLength(1);
    });
  });

  /* `notifyDeleted`-style toasts go through lib/notify and are filtered by `quietNotifications`;
     these two use sonner's `toast` directly, precisely so the Undo is never silenced. The default
     is quiet, so a test that saw the toast anyway is the evidence that still holds. */
  it('shows its toast even though notifications are quiet by default', async () => {
    await seedTree();
    const { user } = await renderNode('e1');

    await user.click(screen.getByRole('button', { name: 'Mark as said' }));

    expect(await screen.findByText('Marked as said')).toBeInTheDocument();
  });
});

describe('TalkingPointItem · hiding for a person', () => {
  const openActions = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /^Actions for/ }));
    return screen.findByRole('menu');
  };

  it('queues the hide against this entry and this person', async () => {
    await seedTree();
    const { user } = await renderNode('e1');

    const menu = await openActions(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Never suggest for Ana' }));

    await waitFor(async () => {
      const ops = await outboxOps();
      expect(ops.at(-1)).toMatchObject({ method: 'PUT', path: `/entries/e1/hidden/${PERSON}` });
    });
  });

  it('drops the entry from the suggestions without marking it as told', async () => {
    await seedTree();
    const { user } = await renderNode('e1');

    const menu = await openActions(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Never suggest for Ana' }));

    await waitFor(async () => {
      const { active, said } = await repo.getTalkingPoints(PERSON);
      expect(active).toHaveLength(0);
      /* The distinction the two marks exist to keep: "I told them" belongs in the already-told
         list, "never suggest this" belongs nowhere. Collapsing them would put things in a history
         of conversations that never happened. */
      expect(said).toHaveLength(0);
    });
  });

  it('names the person in the action, because the mark is only about them', async () => {
    await seedTree();
    const { user } = await renderNode('e1');

    const menu = await openActions(user);

    // The same entry stays a perfectly good talking point for everyone else.
    expect(
      within(menu).getByRole('menuitem', { name: 'Never suggest for Ana' }),
    ).toBeInTheDocument();
  });

  it('offers an Undo that queues the retraction', async () => {
    await seedTree();
    const { user } = await renderNode('e1');

    const menu = await openActions(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Never suggest for Ana' }));
    expect(await screen.findByText('Never suggest for Ana')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(async () => {
      const ops = await outboxOps();
      expect(ops.at(-1)).toMatchObject({ method: 'DELETE', path: `/entries/e1/hidden/${PERSON}` });
    });
  });
});
