import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CircleCheckBig } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginCalendarDay } from '@/plugins/types';
import { anEntry, aPerson } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { seed } from '@/test/seed';
import { resetPreferences, setPreference } from '@/lib/preferences';

/* The plugin view switcher, isolated from the plugin machinery it sits on top of.
 *
 * `usePluginCalendarViews` and `PluginCalendarSlot` each have their own tests for the loading,
 * gating and failure behaviour that is *their* job (usePluginCalendarViews.test.tsx,
 * PluginCalendarSlot.test.tsx) — real plugin locale fetch and dynamic import are never exercised
 * in a test, matching every other page that sits on a plugin surface (PluginPage.test.tsx,
 * PluginDaySlot.test.tsx). What belongs here is only what CalendarPage itself does with the
 * result: show a tab per view, and redraw the grid from whichever one is picked. */
const pluginViews = vi.hoisted(() => ({
  value: [] as { id: string; icon: typeof CircleCheckBig; label: string }[],
}));
const pluginSlotData = vi.hoisted(() => ({
  value: null as ReadonlyMap<string, PluginCalendarDay> | null,
}));

vi.mock('@/plugins/usePluginCalendarViews', () => ({
  usePluginCalendarViews: () => pluginViews.value,
}));

vi.mock('@/plugins/PluginCalendarSlot', async () => {
  const react = await import('react');
  return {
    // Delivers `onData` a tick later, on purpose: the real slot only ever does after an async chunk
    // fetch, and CalendarPage's own effect that clears `pluginData` back to null on a fresh switch
    // fires in the *same* commit as this mount. Calling `onData` synchronously here would race that
    // reset in a way the real, always-async component never does.
    PluginCalendarSlot: ({
      onData,
    }: {
      onData: (data: ReadonlyMap<string, PluginCalendarDay>) => void;
    }) => {
      react.useEffect(() => {
        if (!pluginSlotData.value) return;
        let cancelled = false;
        void Promise.resolve().then(() => {
          if (!cancelled) onData(pluginSlotData.value!);
        });
        return () => {
          cancelled = true;
        };
      }, [onData]);
      return null;
    },
  };
});

vi.mock('@/plugins/registry', () => ({
  findPlugin: (id: string) =>
    id === 'habits'
      ? { id: 'habits', icon: CircleCheckBig, surfaces: ['calendar'], load: vi.fn() }
      : undefined,
}));

const { default: CalendarPage } = await import('./CalendarPage');

/* The month grid.
 *
 * Almost everything here is arithmetic against a real clock — which month is on screen, how many
 * blank cells precede the first, which column each day falls in — so the clock is pinned for the
 * whole file. Without that the suite would quietly change meaning every day and fail on some
 * future morning for reasons nobody could reproduce.
 *
 * The week-start preference gets two tests of its own because its failure mode is invisible: get
 * the rotation wrong and every date in the month is rendered under the wrong weekday, while the
 * page still looks entirely plausible.
 */

const TODAY = '2026-08-09';

beforeEach(() => {
  // Date only — user-event and waitFor need their timers real. See PeopleListPage.test.tsx.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00.000Z`) });
  resetPreferences();
  pluginViews.value = [];
  pluginSlotData.value = null;
});

afterEach(() => {
  vi.useRealTimers();
  resetPreferences();
});

/* The router needs a `/diary/:date` route to land on, even though nothing here asserts against it.
   Clicking a day navigates, and without a matching route react-router raises a navigational 404 —
   which does not fail any assertion but is reported as an unhandled error, intermittently turning
   the whole suite red on a file whose own tests all pass. */
const setup = () =>
  ({
    user: userEvent.setup(),
    ...renderWithProviders(null, {
      routes: [
        { path: '/', element: <CalendarPage /> },
        { path: '/diary/:date', element: <div /> },
      ],
    }),
  }) as const;

/** The day buttons, in grid order. Blank leading/trailing cells are plain divs, so they are out. */
const dayCells = () =>
  screen.getAllByRole('button').filter((el) => /^\d{1,2}$/.test(el.textContent ?? ''));

/** The seven column headings, which are the visible form of the week-start setting. */
const weekdayHeaders = () =>
  screen
    .getAllByText(/^(Mo|Tu|We|Th|Fr|Sa|Su)$/)
    .map((el) => el.textContent ?? '')
    .slice(0, 7);

describe('CalendarPage · the grid', () => {
  it('opens on the current month and gives every day of it a cell', async () => {
    await seed({});

    setup();

    expect(await screen.findByText('August 2026')).toBeInTheDocument();
    // 31 days, and no more — a leading blank rendered as a day would be a clickable 32nd.
    await waitFor(() => expect(dayCells()).toHaveLength(31));
  });

  it('starts the week where the active language starts it', async () => {
    await seed({});

    setup();

    await screen.findByText('August 2026');
    /* `weekStartsOn: 'auto'` is the default and defers to the language — `localeWeekStart('en')`
       is Sunday. The whole header row is asserted rather than its first cell, because a rotation
       is only ever wrong in the *sequence*: any single column, read alone, looks fine. */
    expect(weekdayHeaders()).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
  });

  it('re-lays the grid when the week is set to start on Monday', async () => {
    await seed({});
    setPreference('weekStartsOn', 1);

    setup();

    await screen.findByText('August 2026');
    // An explicit choice overrides the language's own convention rather than merely agreeing
    // with it — which is the only thing this preference exists to do.
    expect(weekdayHeaders()).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    // And the grid still holds exactly one cell per real day; the offset moved, not the month.
    await waitFor(() => expect(dayCells()).toHaveLength(31));
  });

  it('moves a month at a time, and comes back to today on request', async () => {
    await seed({});
    const { user } = setup();

    await screen.findByText('August 2026');

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByText('July 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(await screen.findByRole('button', { name: 'Next month' }));
    expect(await screen.findByText('September 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText('August 2026')).toBeInTheDocument();
  });

  it('opens the day that was clicked', async () => {
    await seed({ entries: [anEntry({ id: 'e1', content: 'Bought milk', dateKey: '2026-08-03' })] });
    const { user, router } = setup();

    await screen.findByText('August 2026');
    await user.click(dayCells().find((cell) => cell.textContent === '3')!);

    /* Asserted on the router rather than a mocked useNavigate: the date in the URL is the entire
       payload of this interaction, and an off-by-one in the cell→dateKey mapping — the exact bug
       the leading-blanks maths invites — would be invisible any other way. */
    await waitFor(() => expect(router.state.location.pathname).toBe('/diary/2026-08-03'));
  });
});

describe('CalendarPage · what the grid shows', () => {
  it('marks the days that have entries, and leaves the empty ones bare', async () => {
    await seed({
      entries: [
        anEntry({ id: 'e1', content: 'Bought milk', dateKey: '2026-08-03', importance: 2 }),
        // A sub-entry, which the heatmap deliberately ignores — the count is top-level entries,
        // matching what the server computes.
        anEntry({ id: 'e2', content: 'Semi-skimmed', dateKey: '2026-08-03', parentId: 'e1' }),
      ],
    });

    setup();

    await screen.findByText('August 2026');
    const third = await waitFor(() => {
      const cell = dayCells().find((c) => c.textContent === '3');
      expect(cell).toHaveAttribute('style');
      return cell!;
    });
    expect(third.getAttribute('style')).toContain('background-color');

    const fourth = dayCells().find((cell) => cell.textContent === '4')!;
    expect(fourth.getAttribute('style') ?? '').not.toContain('background-color');
  });

  it('flags a birthday on the day it falls, in whichever year is on screen', async () => {
    await seed({ people: [aPerson({ id: 'p1', name: 'Ana', birthday: '1990-08-20' })] });

    setup();

    await screen.findByText('August 2026');
    /* The legend only appears when the visible month actually has one, so it doubles as the
       assertion that `birthdaysOn` matched — it ignores the stored year and lands the date in
       whichever year the grid is showing. */
    expect(await screen.findByText('Birthdays')).toBeInTheDocument();
  });

  it('surfaces the same day in earlier years, and only the memorable ones', async () => {
    await seed({
      entries: [
        // Importance 1 clears the default memory threshold; 5 does not.
        anEntry({ id: 'e1', content: 'Moved house', dateKey: '2024-08-09', importance: 1 }),
        anEntry({ id: 'e2', content: 'Did the washing', dateKey: '2024-08-09', importance: 5 }),
      ],
    });

    setup();

    expect(await screen.findByText('Moved house')).toBeInTheDocument();
    expect(screen.queryByText('Did the washing')).not.toBeInTheDocument();
  });
});

describe('CalendarPage · the plugin view switcher', () => {
  it('shows no switcher at all when no plugin has a calendar view', async () => {
    await seed({});
    setup();

    await screen.findByText('August 2026');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('offers a tab per plugin, alongside the diary’s own entries', async () => {
    pluginViews.value = [{ id: 'habits', icon: CircleCheckBig, label: 'Habits' }];
    await seed({});
    setup();

    await screen.findByText('August 2026');
    expect(screen.getByRole('tab', { name: 'Entries' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: 'Habits' })).toBeInTheDocument();
  });

  it('redraws the grid from the picked plugin’s data instead of the entries heatmap', async () => {
    pluginViews.value = [{ id: 'habits', icon: CircleCheckBig, label: 'Habits' }];
    pluginSlotData.value = new Map([['2026-08-03', { level: 1, label: '2/2 habits met' }]]);
    // An entry on the 4th, so the two views can be told apart by which day is shaded.
    await seed({ entries: [anEntry({ id: 'e1', content: 'Bought milk', dateKey: '2026-08-04' })] });
    const { user } = setup();

    await screen.findByText('August 2026');
    // Before switching, the 3rd (the plugin's day) is bare and the 4th (the entry) is shaded.
    expect(
      dayCells()
        .find((c) => c.textContent === '3')
        ?.getAttribute('style') ?? '',
    ).not.toContain('background-color');

    await user.click(screen.getByRole('tab', { name: 'Habits' }));

    await waitFor(() => {
      const third = dayCells().find((c) => c.textContent === '3');
      expect(third?.getAttribute('style') ?? '').toContain('background-color');
    });
    // And the entries heatmap is gone — the 4th no longer carries the importance marker either,
    // since a plugin's "level" has no such breakdown to draw one from.
    const fourth = dayCells().find((c) => c.textContent === '4')!;
    expect(fourth.getAttribute('style') ?? '').not.toContain('background-color');
  });
});
