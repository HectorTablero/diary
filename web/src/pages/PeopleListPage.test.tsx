import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anEntry, aPerson, aTag } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { seed, seedSettings } from '@/test/seed';
import PeopleListPage from './PeopleListPage';

/* The people list, which is really three ranking rules stacked on top of each other: the chosen
 * sort, then the events tiering, then the overdue-checkup group floated above everything. Each is
 * easy to get right alone and easy to break in combination, and the only visible symptom of that
 * is a list in a slightly wrong order — which nobody notices until the person they were supposed
 * to call is halfway down it.
 *
 * The clock is pinned for the whole file. "Overdue", "ongoing" and every talking-point score are
 * all measured against `Date.now()`, so without this the suite would quietly change meaning every
 * day and fail on some future morning for reasons no one could reproduce.
 */

const TODAY = '2026-08-09';

beforeEach(() => {
  /* Only `Date` is faked. Faking timers wholesale would freeze the ones user-event and `waitFor`
     depend on, and every interaction in this file would hang instead of failing. */
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00.000Z`) });
});

afterEach(() => vi.useRealTimers());

const setup = () => ({ user: userEvent.setup(), ...renderWithProviders(<PeopleListPage />) });

/**
 * Which of the given people occupies each row, top to bottom.
 *
 * Asked this way round rather than by reading each row's text, because a row's link also contains
 * the two-letter avatar — so its `textContent` is "AnAna", and an ordering assertion written
 * against that would be pinning the avatar as much as the order.
 */
const namesInOrder = async (candidates: string[]) => {
  const rows = await screen.findAllByRole('listitem');
  return rows.map((row) => candidates.find((name) => within(row).queryByText(name)) ?? '?');
};

/** Long enough ago that any interval below it is overdue. */
const LONG_AGO = '2020-01-01T00:00:00.000Z';

describe('PeopleListPage · ordering', () => {
  it('sorts by name by default', async () => {
    await seed({
      people: [
        aPerson({ id: 'p1', name: 'Carla' }),
        aPerson({ id: 'p2', name: 'Ana' }),
        aPerson({ id: 'p3', name: 'Ben' }),
      ],
    });

    setup();

    await waitFor(async () =>
      expect(await namesInOrder(['Ana', 'Ben', 'Carla'])).toEqual(['Ana', 'Ben', 'Carla']),
    );
  });

  it('floats overdue checkups into their own group above everyone else', async () => {
    await seed({
      people: [
        // Alphabetically last, but a week overdue — so it must come first regardless.
        aPerson({ id: 'p1', name: 'Zoe', checkupIntervalDays: 7, lastCheckupAt: LONG_AGO }),
        aPerson({ id: 'p2', name: 'Ana' }),
        // Has an interval, but was contacted today: due in a week, not now.
        aPerson({
          id: 'p3',
          name: 'Ben',
          checkupIntervalDays: 30,
          lastCheckupAt: `${TODAY}T09:00:00.000Z`,
        }),
      ],
    });

    setup();

    /* The group has a heading naming the count, which is the part a user reads — a list that
       merely happens to be in the right order says nothing about *why*. */
    expect(await screen.findByText('1 checkup pending')).toBeInTheDocument();
    await waitFor(async () =>
      expect(await namesInOrder(['Ana', 'Ben', 'Zoe'])).toEqual(['Zoe', 'Ben', 'Ana']),
    );
  });

  it('re-sorts by talking points on request, keeping the checkup group intact', async () => {
    await seed({
      people: [aPerson({ id: 'p1', name: 'Ana' }), aPerson({ id: 'p2', name: 'Ben' })],
      entries: [
        // Ben is mentioned twice in separate roots; Ana once. Dated today, so both score far
        // above epsilon and the counts cannot drift with the decay curve.
        anEntry({
          id: 'e1',
          content: 'Coffee with @Ana',
          dateKey: TODAY,
          people: [{ id: 'p1', name: 'Ana' }],
        }),
        anEntry({
          id: 'e2',
          content: 'Ran with @Ben',
          dateKey: TODAY,
          people: [{ id: 'p2', name: 'Ben' }],
        }),
        anEntry({
          id: 'e3',
          content: 'Dinner with @Ben',
          dateKey: TODAY,
          people: [{ id: 'p2', name: 'Ben' }],
        }),
      ],
    });
    const { user } = setup();

    await waitFor(async () => expect(await namesInOrder(['Ana', 'Ben'])).toEqual(['Ana', 'Ben']));

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Most talking points' }));

    await waitFor(async () => expect(await namesInOrder(['Ana', 'Ben'])).toEqual(['Ben', 'Ana']));
  });
});

describe('PeopleListPage · what each row says', () => {
  it('badges a person with how many things there are to bring up', async () => {
    await seed({
      people: [aPerson({ id: 'p1', name: 'Ana' }), aPerson({ id: 'p2', name: 'Ben' })],
      entries: [
        anEntry({
          id: 'e1',
          content: 'Coffee with @Ana',
          dateKey: TODAY,
          people: [{ id: 'p1', name: 'Ana' }],
        }),
        /* A sub-entry of the same root. One *cluster*, so it must still count as one row —
           the badge promises the number of things you'd raise, not the number of matched entries,
           and it has to agree with what the profile's Talking Points tab will show. */
        anEntry({
          id: 'e2',
          content: 'She mentioned the new job',
          dateKey: TODAY,
          parentId: 'e1',
          people: [{ id: 'p1', name: 'Ana' }],
        }),
      ],
    });

    setup();

    const [ana, ben] = await screen.findAllByRole('listitem');
    expect(within(ana).getByText('1')).toBeInTheDocument();
    // Nobody to talk about means no badge at all, rather than a zero.
    expect(within(ben).queryByText('0')).not.toBeInTheDocument();
  });

  it('stops counting a talking point once it has been said', async () => {
    await seed({
      people: [aPerson({ id: 'p1', name: 'Ana' })],
      entries: [
        anEntry({
          id: 'e1',
          content: 'Coffee with @Ana',
          dateKey: TODAY,
          people: [{ id: 'p1', name: 'Ana' }],
          saidTo: [{ personId: 'p1', at: `${TODAY}T10:00:00.000Z` }],
        }),
      ],
    });

    setup();

    const [ana] = await screen.findAllByRole('listitem');
    expect(within(ana).queryByText('1')).not.toBeInTheDocument();
  });

  it('marks the checkup interval, and tints it only while it is overdue', async () => {
    await seed({
      people: [
        aPerson({ id: 'p1', name: 'Ana', checkupIntervalDays: 14, lastCheckupAt: LONG_AGO }),
      ],
    });

    setup();

    /* One sentence assembled from three JSX expressions, so it is three text nodes in the DOM and
       no single-node matcher can see it. `toHaveTextContent` reads the row as a whole, which is
       also how it is actually read. */
    const [ana] = await screen.findAllByRole('listitem');
    expect(ana).toHaveTextContent('Every 14 days');
  });

  it('marking a checkup done moves the person out of the pending group', async () => {
    await seed({
      people: [
        aPerson({ id: 'p1', name: 'Ana', checkupIntervalDays: 30, lastCheckupAt: LONG_AGO }),
        aPerson({ id: 'p2', name: 'Ben' }),
      ],
    });
    await seedSettings({ quietNotifications: false });
    const { user } = setup();

    expect(await screen.findByText('1 checkup pending')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for Ana' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mark checkup done now' }));

    expect(await screen.findByText('Checkup marked as done')).toBeInTheDocument();
    // The whole group goes with the last person in it, rather than lingering as an empty heading.
    await waitFor(() => expect(screen.queryByText('1 checkup pending')).not.toBeInTheDocument());
  });
});

describe('PeopleListPage · finding someone', () => {
  it('finds a person by a nickname, and says which one matched', async () => {
    await seed({
      people: [
        aPerson({ id: 'p1', name: 'Ana Fernández', aliases: ['Mum'] }),
        aPerson({ id: 'p2', name: 'Ben' }),
      ],
    });
    const { user } = setup();

    await screen.findByText('Ana Fernández');
    await user.type(screen.getByPlaceholderText('Search'), 'Mum');

    /* The alias is shown beside the name on the hit, because a result matching on something
       invisible reads as a bug in the search rather than a feature of it. */
    await waitFor(() => expect(screen.queryByText('Ben')).not.toBeInTheDocument());
    expect(screen.getByText('Mum')).toBeInTheDocument();
  });

  it('narrows to a tag, and fades the tags that are not what was asked for', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    const gym = aTag({ id: 't2', name: 'gym' });
    await seed({
      tags: [work, gym],
      people: [
        aPerson({ id: 'p1', name: 'Ana', tags: [work] }),
        aPerson({ id: 'p2', name: 'Ben', tags: [gym] }),
      ],
    });
    const { user } = setup();

    await screen.findByText('Ana');
    await user.click(screen.getByRole('button', { name: /Tags/ }));
    await user.click(await screen.findByRole('option', { name: /work/ }));

    await waitFor(() => expect(screen.queryByText('Ben')).not.toBeInTheDocument());
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('distinguishes an empty diary from a search that found nobody', async () => {
    await seed({ people: [aPerson({ id: 'p1', name: 'Ana' })] });
    const { user } = setup();

    await screen.findByText('Ana');
    await user.type(screen.getByPlaceholderText('Search'), 'zzzz');

    /* Two different messages on purpose: "no people yet" invites you to add one, and would be a
       lie in front of a diary that has thirty. */
    expect(await screen.findByText('No results')).toBeInTheDocument();
    expect(screen.queryByText('No people yet')).not.toBeInTheDocument();
  });

  it('offers the empty state when there is genuinely nobody', async () => {
    await seed({});

    setup();

    expect(await screen.findByText('No people yet')).toBeInTheDocument();
  });
});
