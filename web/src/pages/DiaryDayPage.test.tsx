import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { anEntry, aPerson, aTag } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { seed } from '@/test/seed';
import DiaryDayPage from './DiaryDayPage';

/* The first page test, and deliberately the one that exercises the whole chain end to end:
   fixtures → the real Dexie store → the real repo (join maps, tree building, order keys) → the real
   react-query hooks → the component → the real router.

   Nothing here is mocked. That is the point — if this file passes, the harness works, and every
   later test can stop wondering whether it is asserting against a stub of itself. */

const DAY = '2026-08-01';

/**
 * Find an entry by its text.
 *
 * A plain `getByText` cannot: EntryContent splits the content into one element per segment so that
 * `@mentions` and `#tags` can be links, so "Reviewed the plan with @Ana" is three elements and
 * matches none of them. Matching on the paragraph's whole `textContent` asks the question the test
 * actually means — is this sentence on screen — rather than a question about the markup.
 */
const findEntry = (text: string) =>
  screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === text);

/** The page is a lazy default export mounted under a parameterised route; mount it the same way. */
const renderDay = (date: string) =>
  renderWithProviders(<DiaryDayPage />, {
    path: '/diary/:date',
    initialEntries: [`/diary/${date}`],
  });

describe('DiaryDayPage', () => {
  it('renders the day it was asked for, with sub-entries nested under their parent', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'Ran into Ana at the market', dateKey: DAY }),
        anEntry({ id: 'e2', content: 'She has a new job', dateKey: DAY, parentId: 'e1' }),
        anEntry({ id: 'e3', content: 'Booked the dentist', dateKey: DAY }),
        // A different day, to prove the query is actually scoped rather than reading everything.
        anEntry({ id: 'e4', content: 'Yesterday thing', dateKey: '2026-07-31' }),
      ],
    });

    renderDay(DAY);

    expect(await findEntry('Ran into Ana at the market')).toBeInTheDocument();
    expect(await findEntry('Booked the dentist')).toBeInTheDocument();
    expect(await findEntry('She has a new job')).toBeInTheDocument();
    expect(screen.queryByText('Yesterday thing')).not.toBeInTheDocument();

    /* Nesting asserted through the control that announces it, because that is the part a user (or a
       screen reader) actually gets: the parent row carries a toggle labelled with its sub-entry
       count, and the two childless rows carry one saying zero. Asserting on the DOM nesting instead
       would pin the markup rather than the behaviour — `repo.ts` builds the tree, and this is the
       observable consequence of it having done so. */
    expect(screen.getByRole('button', { name: '1 sub-entry' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '0 sub-entries' })).toHaveLength(2);
  });

  it('shows the empty state for a day with nothing in it', async () => {
    await seed({ entries: [anEntry({ id: 'e1', content: 'Elsewhere', dateKey: '2026-07-30' })] });

    renderDay(DAY);

    // The real English string, from the real locale bundle — a renamed key fails here.
    expect(await screen.findByText('No entries for this day')).toBeInTheDocument();
  });

  it('redirects an unparseable date to today rather than rendering a broken day', async () => {
    await seed({});

    const { router } = renderWithProviders(<DiaryDayPage />, {
      path: '/diary/:date',
      initialEntries: ['/diary/not-a-date'],
    });

    /* Asserted on the router rather than through a mocked useNavigate — the redirect is a
       <Navigate> element, so the only honest evidence it happened is where the router ended up.
       waitFor because react-router wraps navigation in startTransition. */
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/diary\/\d{4}-\d{2}-\d{2}$/);
    });
    expect(router.state.location.pathname).not.toBe('/diary/not-a-date');
  });

  it('resolves an entry’s tags and mentions into links, from ids alone', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    const ana = aPerson({ id: 'p1', name: 'Ana' });
    await seed({
      tags: [work],
      people: [ana],
      entries: [
        anEntry({
          id: 'e1',
          content: 'Reviewed the plan with @Ana about #work',
          dateKey: DAY,
          tags: [work],
          people: [{ id: ana.id, name: ana.name }],
        }),
      ],
    });

    renderDay(DAY);

    expect(await findEntry('Reviewed the plan with @Ana about #work')).toBeInTheDocument();

    /* The join is the thing under test. Entries are stored normalised — bare id arrays, see db.ts —
       and repo.ts resolves them through its cached lookup maps. A working link therefore proves the
       maps were built *and* that seed()'s `bumpLookupVersion()` invalidated the previous test's. */
    expect(screen.getByRole('link', { name: '@Ana' })).toHaveAttribute('href', '/people/p1');
    // A tag has no page of its own — it links to a pre-filtered search (lib/entityLinks.ts).
    expect(screen.getByRole('link', { name: '#work' })).toHaveAttribute('href', '/search?tags=t1');
  });

  it("announces a person's birthday on the day, with their age", async () => {
    await seed({
      people: [aPerson({ id: 'p1', name: 'Ana', birthday: '1990-08-01' })],
      entries: [],
    });

    renderDay(DAY);

    // 1990 → 2026 is 36. Rendered through <Trans>, so the name is a link inside the sentence and
    // carries the same leading @ an inline mention would.
    expect(await screen.findByRole('link', { name: '@Ana' })).toHaveAttribute('href', '/people/p1');
    expect(screen.getByText(/36/)).toBeInTheDocument();

    /* In its own card, under a heading, like every other band of the day page — it used to be a
       pink-tinted banner, the one coloured panel in the app, which read as an alert about something
       needing attention rather than as a fact about the day. */
    expect(screen.getByRole('heading', { name: 'Birthdays' })).toBeInTheDocument();
  });

  it('puts the birthday card below the composer, not between the entries and it', async () => {
    await seed({
      people: [aPerson({ id: 'p1', name: 'Ana', birthday: '1990-08-01' })],
      entries: [anEntry({ id: 'e1', content: 'Something', dateKey: DAY })],
    });

    renderDay(DAY);

    /* Writing is the page's primary action and must keep its position: however many people share a
       birthday, the box you came here to type in does not move down the screen. */
    const birthdays = await screen.findByRole('heading', { name: 'Birthdays' });
    // By placeholder: the composer's textarea carries role="combobox" for its @/# autocomplete, so
    // it is not findable as a textbox.
    const composer = screen.getByPlaceholderText('What happened? Use @person and #tag…');
    expect(composer.compareDocumentPosition(birthdays) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
