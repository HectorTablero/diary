import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SuggestedEntryNode } from '@diary/shared';
import { db } from '@/db/db';
import * as repo from '@/db/repo';
import { queryClient } from '@/lib/queryClient';
import { aPerson, aTag } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { outboxOps, seed, seedSettings } from '@/test/seed';
import { SuggestionReviewDialog } from './SuggestionReviewDialog';

/* The last gate before a language model writes in someone's diary.
 *
 * Everything the model produced is a *draft* here, and the dialog's whole reason to exist is that a
 * person gets to change it first. That makes two things worth pinning above all: nothing is written
 * until Accept, and what is written is what is on screen at that moment — not what the model
 * originally said.
 *
 * The creates are strictly sequential and parent-first, which looks like a stylistic choice and
 * isn't: a child whose parent does not exist yet is rejected by the server, and the outbox replays
 * in FIFO order. A parallel `Promise.all` here would pass every test that only counts the entries.
 *
 * One thing this file had to work around, and which is worth knowing: the dialog resolves the
 * model's tag and person *ids* against `useTags`/`usePeople` inside an effect keyed on `open`
 * alone. Opened before those queries have answered, every id resolves to nothing and is dropped
 * silently — the suggestion arrives with no tags and no people and nothing says why. It never
 * happens in the app (usePeople is mounted app-wide in AppLayout, so both caches are warm long
 * before a recording finishes), which is exactly why a test that renders the dialog cold has to
 * prime them deliberately rather than pretend the race isn't there.
 */

const DAY = '2026-08-01';
const ANA = { id: 'p1', name: 'Ana' };

const suggestion = (patch: Partial<SuggestedEntryNode> = {}): SuggestedEntryNode => ({
  content: 'Bought milk',
  importance: 3,
  tags: [],
  people: [],
  children: [],
  ...patch,
});

const setup = async (entries: SuggestedEntryNode[], props: Record<string, unknown> = {}) => {
  /* Warm, before the first render — see the note at the top of the file. Filled from the real repo
     rather than by hand so the shapes are the ones the hooks actually produce. */
  queryClient.setQueryData(['tags'], await repo.getTags());
  queryClient.setQueryData(['people'], await repo.getPeople());
  const user = userEvent.setup();
  const rendered = renderWithProviders(
    <SuggestionReviewDialog
      open
      onOpenChange={() => {}}
      entries={entries}
      dateKey={DAY}
      {...props}
    />,
  );
  // The draft is built in an effect once the tag and people queries have answered.
  await screen.findByText('Review suggestions');
  return { user, ...rendered };
};

/**
 * Stored entries, oldest first — which is also the order they were created in.
 *
 * Sorted in memory rather than with `orderBy('createdAt')`: the entries store is indexed on
 * `id, dateKey, parentId, *tagIds, *peopleIds` and nothing else, so asking Dexie to order by
 * `createdAt` throws rather than returning anything.
 */
const storedInOrder = async () =>
  (await db.entries.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

describe('SuggestionReviewDialog · the draft', () => {
  it('shows every suggestion, and counts them on the accept button', async () => {
    await seed({});

    await setup([
      suggestion({ content: 'Bought milk' }),
      suggestion({ content: 'Called the bank' }),
    ]);

    expect(screen.getByDisplayValue('Bought milk')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Called the bank')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add 2 entries' })).toBeInTheDocument();
  });

  it('counts nested suggestions too, because they are all entries', async () => {
    await seed({});

    await setup([
      suggestion({ content: 'Ran into Ana', children: [suggestion({ content: 'New job' })] }),
    ]);

    // The button promises how many rows will appear in the diary, not how many roots were returned.
    expect(screen.getByRole('button', { name: 'Add 2 entries' })).toBeInTheDocument();
  });

  it('resolves the ids the model returned into real tags and people', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    await seed({ tags: [work], people: [aPerson(ANA)] });

    await setup([suggestion({ tags: ['t1'], people: ['p1'] })]);

    /* The model answers with ids, and a chip is how the user checks it picked the right ones — an
       id it invented resolves to nothing and is silently dropped rather than saved. */
    expect(screen.getByText('#work')).toBeInTheDocument();
    expect(screen.getByText('@Ana')).toBeInTheDocument();
  });

  it('says so plainly when the recording produced nothing', async () => {
    await seed({});

    await setup([]);

    expect(screen.getByText('Nothing to suggest from that recording')).toBeInTheDocument();
    // Nothing to add, so the button that would add it is unavailable rather than a no-op.
    expect(screen.getByRole('button', { name: /^Add/ })).toBeDisabled();
  });

  it('writes nothing at all until Accept is pressed', async () => {
    await seed({});

    await setup([suggestion()]);

    /* The claim the whole dialog rests on. A draft that had already been saved would make
       "Discard" a lie and every edit below an edit to the user's real diary. */
    expect(await db.entries.count()).toBe(0);
    expect(await outboxOps()).toHaveLength(0);
  });
});

describe('SuggestionReviewDialog · editing before accepting', () => {
  it('saves the edited text, not what the model said', async () => {
    await seed({});
    const { user } = await setup([suggestion({ content: 'Bought milk' })]);

    const box = screen.getByDisplayValue('Bought milk');
    await user.clear(box);
    await user.type(box, 'Bought oat milk');
    await user.click(screen.getByRole('button', { name: 'Add 1 entry' }));

    await waitFor(async () => {
      const [entry] = await storedInOrder();
      expect(entry?.content).toBe('Bought oat milk');
    });
  });

  it('removes a suggestion, and its children with it', async () => {
    await seed({});
    const { user } = await setup([
      suggestion({ content: 'Ran into Ana', children: [suggestion({ content: 'New job' })] }),
      suggestion({ content: 'Bought milk' }),
    ]);

    // The first Remove belongs to the root of the two-node tree. (Neither suggestion has people,
    // so there are no chip remove buttons competing for the same name here.)
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]);

    /* A subtree is one thought. Removing the parent and keeping the child would leave a fragment
       with nothing to attach to — and the count on the button is what says so. */
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add 1 entry' })).toBeInTheDocument(),
    );
    expect(screen.queryByDisplayValue('New job')).not.toBeInTheDocument();
  });

  it('skips a suggestion emptied during editing rather than saving a blank entry', async () => {
    await seed({});
    const { user } = await setup([
      suggestion({ content: 'Bought milk' }),
      suggestion({ content: 'Called the bank' }),
    ]);

    await user.clear(screen.getByDisplayValue('Bought milk'));
    await user.click(screen.getByRole('button', { name: 'Add 2 entries' }));

    await waitFor(async () => {
      const stored = await storedInOrder();
      // Emptying is how you drop one without hunting for its Remove button; a blank entry in the
      // diary would be the alternative, and there is no way to write one deliberately.
      expect(stored.map((e) => e.content)).toEqual(['Called the bank']);
    });
  });
});

/* The per-person "will be marked as said to" boxes — the same decision the composer offers, made
   here for several entries at once. Getting it wrong is quiet in the usual way: an entry marked as
   said to someone it was never said to simply never appears in their talking points again. */
describe('SuggestionReviewDialog · who it was said to', () => {
  it('pre-ticks everyone the entry mentions', async () => {
    await seed({ people: [aPerson(ANA)] });

    await setup([suggestion({ people: ['p1'] })]);

    expect(screen.getByText('Will be marked as said to')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Ana' })).toBeChecked();
  });

  it('offers nothing to tick when the entry names nobody', async () => {
    await seed({ people: [aPerson(ANA)] });

    await setup([suggestion()]);

    // The whole block is absent rather than empty — there is no question to ask.
    expect(screen.queryByText('Will be marked as said to')).not.toBeInTheDocument();
  });

  it('carries an unticked person through as linked but not said to', async () => {
    await seed({ people: [aPerson(ANA)] });
    const { user } = await setup([suggestion({ people: ['p1'] })]);

    await user.click(screen.getByRole('checkbox', { name: 'Ana' }));
    await user.click(screen.getByRole('button', { name: 'Add 1 entry' }));

    const [entry] = await waitFor(async () => {
      const stored = await storedInOrder();
      expect(stored).toHaveLength(1);
      return stored;
    });
    /* Still about Ana — that is what the mention says — but not yet told to her, so it stays in
       her talking points. The two lists are independent on purpose. */
    expect(entry.peopleIds).toEqual(['p1']);
    expect(entry.saidTo).toEqual([]);
  });

  it('drops the said mark when the person is removed entirely', async () => {
    await seed({ people: [aPerson(ANA)] });
    const { user } = await setup([suggestion({ people: ['p1'] })]);

    /* Scoped to the chip. Both the person chip's remove control and the whole-suggestion delete
       button are labelled "Remove" — `ai.deletePoint` and the chip's hardcoded label happen to
       collide — so an unscoped query here is ambiguous, and picking the wrong one deletes the
       entire suggestion instead of one person. Worth fixing in the app; scoped here so the test
       says what it means either way. */
    const chip = screen.getByText('@Ana').parentElement!;
    await user.click(within(chip).getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Add 1 entry' }));

    const [entry] = await waitFor(async () => {
      const stored = await storedInOrder();
      expect(stored).toHaveLength(1);
      return stored;
    });
    // A said-mark for someone the entry no longer mentions would be unreachable from every screen.
    expect(entry.peopleIds).toEqual([]);
    expect(entry.saidTo).toEqual([]);
  });
});

describe('SuggestionReviewDialog · accepting', () => {
  it('creates parents before their children, and links them up', async () => {
    await seed({});
    const { user } = await setup([
      suggestion({
        content: 'Ran into Ana',
        children: [suggestion({ content: 'She has a new job' })],
      }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Add 2 entries' }));

    const stored = await waitFor(async () => {
      const rows = await storedInOrder();
      expect(rows).toHaveLength(2);
      return rows;
    });
    const parent = stored.find((e) => e.content === 'Ran into Ana')!;
    const child = stored.find((e) => e.content === 'She has a new job')!;
    expect(child.parentId).toBe(parent.id);

    /* Order, not just linkage: the server rejects a child whose parent it has not seen, and the
       outbox replays in the order it was filled. A parallel create would pass the assertion above
       and fail on the first sync. */
    const ops = await outboxOps();
    const paths = ops.map((op) => (op.body as { id: string; parentId: string | null }).id);
    expect(paths.indexOf(parent.id)).toBeLessThan(paths.indexOf(child.id));
  });

  it('queues one create per entry, carrying the client-generated id', async () => {
    await seed({});
    const { user } = await setup([suggestion(), suggestion({ content: 'Called the bank' })]);

    await user.click(screen.getByRole('button', { name: 'Add 2 entries' }));

    const ops = await waitFor(async () => {
      const queued = await outboxOps();
      expect(queued).toHaveLength(2);
      return queued;
    });
    expect(ops.every((op) => op.method === 'POST' && op.path === '/entries')).toBe(true);
    /* The id is minted when the draft is built, not on save — which is what lets a child reference
       its parent before either has been written, and what makes the create idempotent on replay. */
    const stored = await storedInOrder();
    expect(ops.map((op) => (op.body as { id: string }).id).sort()).toEqual(
      stored.map((e) => e.id).sort(),
    );
  });

  it('never assigns a thread, because grouping is a human call', async () => {
    await seed({});
    const { user } = await setup([suggestion()]);

    await user.click(screen.getByRole('button', { name: 'Add 1 entry' }));

    const [op] = await waitFor(async () => {
      const queued = await outboxOps();
      expect(queued).toHaveLength(1);
      return queued;
    });
    // The entries can be threaded afterwards from the day view's ⋯ menu; the model does not decide.
    expect((op.body as { threads: string[] }).threads).toEqual([]);
  });

  it('nests the whole draft under the entry it was recorded against', async () => {
    await seed({});
    const { user } = await setup([suggestion()], {
      parentId: 'existing_entry',
      parentContent: 'Ran into Ana',
    });

    await user.click(screen.getByRole('button', { name: 'Add 1 entry' }));

    const [entry] = await waitFor(async () => {
      const stored = await storedInOrder();
      expect(stored).toHaveLength(1);
      return stored;
    });
    // A sub-entry recording adds detail to something already written, so its roots are children.
    expect(entry.parentId).toBe('existing_entry');
  });

  it('confirms out loud how many entries were added', async () => {
    await seed({});
    await seedSettings({ quietNotifications: false });
    const { user } = await setup([suggestion(), suggestion({ content: 'Called the bank' })]);

    await user.click(screen.getByRole('button', { name: 'Add 2 entries' }));

    expect(await screen.findByText('2 entries added')).toBeInTheDocument();
  });

  it('stamps every entry with the day the recording was about', async () => {
    await seed({});
    const { user } = await setup([suggestion(), suggestion({ content: 'Called the bank' })]);

    await user.click(screen.getByRole('button', { name: 'Add 2 entries' }));

    await waitFor(async () => {
      const stored = await storedInOrder();
      expect(stored).toHaveLength(2);
      // The day being written about, not the day the transcript happened to be reviewed.
      expect(stored.every((entry) => entry.dateKey === DAY)).toBe(true);
    });
  });
});
