import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { anEntry, aPerson, aTag } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { seed } from '@/test/seed';
import SearchPage from './SearchPage';

/* Search, which keeps all of its state in the URL and none of it in React.
 *
 * That is the thing worth pinning. Every filter here is a query parameter, the query key is the
 * serialised parameters, and `repo.search` reads them back out — so a filter that fails to reach
 * the URL is a filter that silently does nothing, and one that reaches it under the wrong name is
 * a result set that quietly ignores it. Both look like "search is a bit odd" from the outside.
 *
 * Tests therefore start from a URL where they can, and assert on the router where a control is
 * supposed to change one.
 */

const DAY = '2026-08-01';

const renderSearch = (url = '/search') => ({
  user: userEvent.setup(),
  ...renderWithProviders(<SearchPage />, { path: '/search', initialEntries: [url] }),
});

/**
 * The entries currently listed, in order.
 *
 * Scoped to the result `<li>`s rather than to every paragraph on the page: the "N results" line is
 * a `<p>` too, and a helper that swept those up would make `expect(results()).toContain(…)` quietly
 * true for the wrong reason. Each row's first paragraph is its EntryContent — which splits its own
 * text across a span per segment, so `textContent` is the only thing that reads the sentence.
 */
const results = () =>
  screen.queryAllByRole('listitem').map((row) => row.querySelector('p')?.textContent ?? '');

describe('SearchPage', () => {
  it('opens on the whole diary, newest first', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'Older thing', dateKey: '2026-07-01' }),
        anEntry({ id: 'e2', content: 'Newer thing', dateKey: '2026-08-01' }),
      ],
    });

    renderSearch();

    // An unfiltered search is every entry — the page is a browsable index as much as a search box,
    // and `repo.search` sorts by date descending so the most recent is the first thing you see.
    await waitFor(() => expect(results()).toEqual(['Newer thing', 'Older thing']));
  });

  it('says so plainly when nothing matches', async () => {
    await seed({ entries: [anEntry({ id: 'e1', content: 'Bought milk', dateKey: DAY })] });

    renderSearch('/search?q=aardvark');

    expect(await screen.findByText('No entries found')).toBeInTheDocument();
    expect(results()).toEqual([]);
  });

  it('filters on free text, after the typing has settled', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'Bought milk', dateKey: DAY }),
        anEntry({ id: 'e2', content: 'Booked the dentist', dateKey: DAY }),
      ],
    });
    const { user, router } = renderSearch();

    await user.type(screen.getByPlaceholderText('Search your entries…'), 'milk');

    /* The input is debounced into the URL by 300ms — deliberately, since every keystroke would
       otherwise be a history entry and a query key. So the assertion waits on the *URL*, which is
       where the state really lives. */
    /* Timeouts well above Testing Library's one-second default, because this path is two waits
       stacked: the 300ms debounce, and then a query keyed on the new URL having to refetch. Under a
       loaded runner that comfortably exceeds a second, and the result is a test that fails a run in
       twenty for no reason anyone can reproduce. */
    await waitFor(() => expect(router.state.location.search).toContain('q=milk'), {
      timeout: 5000,
    });
    // The whole set, not `toContain`: an unfiltered page already contains "Bought milk", so a
    // containment check would pass before the filter had done anything at all.
    await waitFor(() => expect(results()).toEqual(['Bought milk']), { timeout: 5000 });
  });

  it('honours a tag filter arriving in the URL, and names it in a removable chip', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    await seed({
      tags: [work],
      entries: [
        anEntry({ id: 'e1', content: 'Shipped the thing', dateKey: DAY, tags: [work] }),
        anEntry({ id: 'e2', content: 'Bought milk', dateKey: DAY }),
      ],
    });

    /* Exactly the link an entry's `#work` token points at (lib/entityLinks.ts) — a tag has no page
       of its own, so this URL *is* the tag's page and has to work cold, from a bookmark. */
    const { user } = renderSearch('/search?tags=t1');

    await waitFor(() => expect(results()).toEqual(['Shipped the thing']));

    // The chip's own remove control, which is a button inside the chip rather than the chip
    // itself — a removable chip is deliberately never a link (see chips.tsx).
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    // Removing the chip removes the filter, and everything comes back.
    await waitFor(() => expect(results()).toContain('Bought milk'));
  });

  it('combines a query with a tag filter rather than choosing between them', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    await seed({
      tags: [work],
      entries: [
        anEntry({ id: 'e1', content: 'Shipped the milk run', dateKey: DAY, tags: [work] }),
        anEntry({ id: 'e2', content: 'Shipped the thing', dateKey: DAY, tags: [work] }),
        anEntry({ id: 'e3', content: 'Bought milk', dateKey: DAY }),
      ],
    });

    renderSearch('/search?q=milk&tags=t1');

    // Only the entry satisfying both — an OR here would be a filter that widens as you narrow.
    await waitFor(() => expect(results()).toEqual(['Shipped the milk run']));
    expect(results()).not.toContain('Shipped the thing');
    expect(results()).not.toContain('Bought milk');
  });

  it('filters by who an entry is about', async () => {
    const ana = aPerson({ id: 'p1', name: 'Ana' });
    await seed({
      people: [ana],
      entries: [
        anEntry({
          id: 'e1',
          content: 'Coffee with @Ana',
          dateKey: DAY,
          people: [{ id: 'p1', name: 'Ana' }],
        }),
        anEntry({ id: 'e2', content: 'Bought milk', dateKey: DAY }),
      ],
    });

    renderSearch('/search?people=p1');

    await waitFor(() => expect(results()).toEqual(['Coffee with @Ana']));
    expect(results()).not.toContain('Bought milk');
  });

  it('filters by importance, and says which levels are on', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'Moved house', dateKey: DAY, importance: 1 }),
        anEntry({ id: 'e2', content: 'Did the washing', dateKey: DAY, importance: 5 }),
      ],
    });
    const { user, router } = renderSearch();

    // The dots are toggles with no text of their own, so the level's name is the button's name —
    // and `aria-pressed` is the only thing that states which are on.
    const transformative = screen.getByRole('button', { name: 'Transformative' });
    expect(transformative).toHaveAttribute('aria-pressed', 'false');

    await user.click(transformative);

    await waitFor(() => expect(router.state.location.search).toContain('importance=1'));
    expect(transformative).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(results()).toEqual(['Moved house']));
    expect(results()).not.toContain('Did the washing');
  });

  it('narrows to a date range', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'In range', dateKey: '2026-08-05' }),
        anEntry({ id: 'e2', content: 'Too early', dateKey: '2026-07-01' }),
        anEntry({ id: 'e3', content: 'Too late', dateKey: '2026-09-01' }),
      ],
    });

    renderSearch('/search?from=2026-08-01&to=2026-08-31');

    await waitFor(() => expect(results()).toEqual(['In range']));
    expect(results()).not.toContain('Too early');
    expect(results()).not.toContain('Too late');
  });

  /* Paging is where the URL-as-state design earns its keep and also where it can go wrong: the
     page number is the one parameter that must *not* be reset when it changes, while every other
     control must reset it — otherwise narrowing a search from page 3 lands on an empty page 3. */
  it('pages through a result set larger than one page', async () => {
    await seed({
      entries: Array.from({ length: 55 }, (_, i) =>
        anEntry({
          id: `e${i}`,
          content: `Entry number ${i}`,
          // Descending days so the sort order is stable and the split is predictable.
          dateKey: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
        }),
      ),
    });
    const { user, router } = renderSearch('/search?q=Entry');

    expect(await screen.findByText('55 results')).toBeInTheDocument();
    // The page size is 50, so a 55-result set is two pages and the first holds fifty of them.
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '›' }));

    await waitFor(() => expect(router.state.location.search).toContain('page=2'));
    expect(await screen.findByText('2 / 2')).toBeInTheDocument();
    // The query survived the page change — this is the `resetPage = false` path.
    expect(router.state.location.search).toContain('q=Entry');
  });

  it('sends a changed filter back to the first page', async () => {
    await seed({
      entries: Array.from({ length: 55 }, (_, i) =>
        anEntry({ id: `e${i}`, content: `Entry number ${i}`, dateKey: DAY }),
      ),
    });
    const { user, router } = renderSearch('/search?q=Entry&page=2');

    await screen.findByText('2 / 2');

    await user.click(screen.getByRole('button', { name: 'Transformative' }));

    /* Every other control resets the page, because the old page number means nothing against a
       new result set — and landing on an empty page reads as "no results" rather than as page 2. */
    await waitFor(() => expect(router.state.location.search).not.toContain('page='));
  });

  it('clears everything at once', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    await seed({
      tags: [work],
      entries: [anEntry({ id: 'e1', content: 'Bought milk', dateKey: DAY })],
    });
    const { user, router } = renderSearch('/search?q=milk&tags=t1&importance=3');

    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));

    await waitFor(() => expect(router.state.location.search).toBe(''));
    // The text box empties with the URL — it holds its own draft copy for the debounce, and a
    // clear that left it full would refill the URL 300ms later.
    expect(screen.getByPlaceholderText('Search your entries…')).toHaveValue('');
  });
});
