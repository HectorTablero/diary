import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createPluginRecord } from '@/db/pluginRecords';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import { HabitsDayWidget } from './HabitsDayWidget';
import en from './locales/en.json';
import { habitData, type Habit } from './model';

/* The day card records; it never creates or destroys. Everything asserted here is either about
   recording, or about the boundary — that a habit cannot be made or lost from this screen, and that
   a retired one still shows on the days it actually happened.
 *
 * DATE is pinned as *today* with fake timers for the whole file: every one of these tests predates
 * the lock feature and was written assuming a day is editable by default, which is only true of
 * today now that every other day opens locked. HabitsDayWidget.lock.test.tsx covers the lock
 * itself, against both a past and a future day, so this file stays about recording. */

const DATE = '2026-08-10';

const seed = (patch: Partial<Omit<Habit, 'id'>> & { name: string }) =>
  createPluginRecord(
    'habits',
    'record',
    UNDATED_KEY,
    habitData({
      type: 'binary',
      order: 0,
      archivedAt: null,
      since: '2026-01-01',
      revisions: [],
      ...patch,
    }),
  );

const dayRow = () => db.pluginRecords.where('[pluginId+dateKey]').equals(['habits', DATE]).first();
const valuesOn = async () =>
  ((await dayRow())?.data as { values?: Record<string, number> } | undefined)?.values ?? {};

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { habits: en } }, true, true);
  await db.pluginRecords.clear();
  await db.outbox.clear();
  // Date only — user-event and waitFor need their timers real. See PeopleListPage.test.tsx.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DATE}T12:00:00.000Z`) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('with no habits at all', () => {
  it('offers the two ways out and no way to create one here', async () => {
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />, {
      routes: [
        { path: '/', element: <HabitsDayWidget dateKey={DATE} /> },
        { path: '/plugins/habits', element: <h1>Habits page</h1> },
      ],
    });

    expect(await screen.findByText('No habits yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up habits' })).toHaveAttribute(
      'href',
      '/plugins/habits',
    );
    expect(screen.getByRole('button', { name: 'Turn off habits' })).toBeInTheDocument();
    // Creating a habit is the plugin page's job — this screen is for writing a diary entry.
    expect(screen.queryByLabelText('Habit name')).not.toBeInTheDocument();
  });

  it('confirms before switching the plugin off', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    await user.click(await screen.findByRole('button', { name: 'Turn off habits' }));

    // One tap from a screen opened to write an entry, and it syncs to every device.
    expect(await screen.findByRole('dialog')).toHaveTextContent('Turn off habits?');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await db.pluginRecords.where('scope').equals('config').count()).toBe(0);
  });
});

describe('recording a tick-box habit', () => {
  it('is a labelled button on the right, and still a checkbox to a screen reader', async () => {
    await seed({ name: 'Read' });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    const control = await screen.findByRole('checkbox', { name: 'Read' });

    /* A 20px box was under half the size a finger is reliably accurate to, and it was the smallest
       control on the card — on the one habit that takes a single tap to record. The semantics were
       never the problem, so they are unchanged: only the target grew. */
    expect(control).toHaveTextContent('Done');
    // At the end of the row, in the column every other kind's control already ends up in.
    expect(screen.getByText('Read').compareDocumentPosition(control)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('stores it as a value on the day row', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Read' });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Read' }));

    await waitFor(async () => expect(Object.keys(await valuesOn())).toHaveLength(1));
    // Every kind stores a number, so "did this happen" is one question rather than two.
    expect(Object.values(await valuesOn())).toEqual([1]);
  });

  it('unticks by removing the key, never by storing a zero', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Read' });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    const box = await screen.findByRole('checkbox', { name: 'Read' });
    await user.click(box);
    await waitFor(async () => expect(Object.keys(await valuesOn())).toHaveLength(1));
    await user.click(box);

    await waitFor(async () => expect(await valuesOn()).toEqual({}));
  });
});

describe('recording a counted habit', () => {
  it('steps the number up and down', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Push-ups', type: 'numeric', unit: 'reps' });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    await user.click(await screen.findByRole('button', { name: 'Add one to Push-ups' }));
    await user.click(screen.getByRole('button', { name: 'Add one to Push-ups' }));

    await waitFor(async () => expect(Object.values(await valuesOn())).toEqual([2]));

    await user.click(screen.getByRole('button', { name: 'Take one off Push-ups' }));
    await waitFor(async () => expect(Object.values(await valuesOn())).toEqual([1]));
  });

  it('cannot go below zero', async () => {
    await seed({ name: 'Push-ups', type: 'numeric' });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByRole('button', { name: 'Take one off Push-ups' })).toBeDisabled();
  });

  it('coalesces a burst of presses into one write', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Push-ups', type: 'numeric' });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    const plus = await screen.findByRole('button', { name: 'Add one to Push-ups' });
    for (let i = 0; i < 4; i++) await user.click(plus);

    /* Every enqueue kicks a sync and runs a full notification reconcile. Four taps on a stepper
       must not be four of those. */
    await waitFor(async () => expect(Object.values(await valuesOn())).toEqual([4]));
    const writes = (await db.outbox.toArray()).filter((op) => op.path === '/plugin-records');
    expect(writes.filter((op) => op.method === 'POST')).toHaveLength(2); // definition + day row
    expect(writes.filter((op) => op.method === 'PATCH')).toHaveLength(0);
  });
});

describe('streaks', () => {
  const seedDays = async (habitId: string, byDay: Record<string, number>) => {
    for (const [day, value] of Object.entries(byDay)) {
      await createPluginRecord('habits', 'record', day, { values: { [habitId]: value } });
    }
  };

  it('counts a day only where the goal was actually reached', async () => {
    const user = userEvent.setup();
    const habit = await seed({ name: 'Push-ups', type: 'numeric', target: 10 });
    await seedDays(habit.id, { '2026-08-08': 10, '2026-08-09': 10 });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    // Two banked. Today untouched neither breaks the run nor extends it.
    expect(await screen.findByLabelText('2 days in a row')).toBeInTheDocument();

    /* One push-up against a goal of ten is progress worth recording and it is not a day of the
       habit. A streak that ticks up on any nonzero number is a streak of having opened the app. */
    await user.click(screen.getByRole('button', { name: 'Add one to Push-ups' }));
    expect(screen.getByLabelText('2 days in a row')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Push-ups' }));
    await user.keyboard('10{Enter}');
    expect(screen.getByLabelText('3 days in a row')).toBeInTheDocument();
  });

  it('holds the new number steady while the write and its reload go by', async () => {
    const user = userEvent.setup();
    const habit = await seed({ name: 'Read' });
    await seedDays(habit.id, { '2026-08-08': 1, '2026-08-09': 1 });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Read' }));
    expect(screen.getByLabelText('3 days in a row')).toBeInTheDocument();

    /* The regression: the streak used to be recomputed from a history map that the debounced write
       and the sync reload it kicks rewrite a second later, so the badge went 3 → 2 → 3. Today is no
       longer read out of that map at all — the run ending yesterday is, and it cannot change. */
    await waitFor(async () => expect(Object.values(await valuesOn())).toEqual([1]));
    await waitFor(() => expect(screen.getByLabelText('3 days in a row')).toBeInTheDocument());
    expect(screen.queryByLabelText('2 days in a row')).not.toBeInTheDocument();
  });

  it('drops back the moment a day is cleared', async () => {
    const user = userEvent.setup();
    const habit = await seed({ name: 'Read' });
    await seedDays(habit.id, { '2026-08-08': 1, '2026-08-09': 1, [DATE]: 1 });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByLabelText('3 days in a row')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear Read' }));

    // Back to the run that does not depend on today — and still not zero, because a blank today is
    // not yet a missed day.
    expect(screen.getByLabelText('2 days in a row')).toBeInTheDocument();
  });
});

describe('which habits are shown', () => {
  it('leaves off a habit created after this day', async () => {
    await seed({ name: 'Read', since: '2026-01-01' });
    await seed({ name: 'Meditate', since: '2026-08-11' }); // the day after DATE

    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByText('Read')).toBeInTheDocument();
    expect(screen.queryByText('Meditate')).not.toBeInTheDocument();
    // Not "every habit retired" either — Meditate exists, it just hasn't started yet, which is a
    // different fact from having been retired.
    expect(screen.queryByText('Every habit is retired.')).not.toBeInTheDocument();
  });

  it('renders no card at all on a day before any habit had been created', async () => {
    await seed({ name: 'Read', since: '2026-08-11' }); // the day after DATE

    const { container } = renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    // Waits for loading to settle (the skeleton is the loading state) before asserting on emptiness
    // — the card must not flash away only after briefly rendering something.
    await waitFor(() => expect(screen.queryByRole('heading')).not.toBeInTheDocument());
    // Scoped to the widget's own section rather than the whole render container, which also holds
    // the app's (unrelated, always-present) toast region.
    expect(container.querySelector('[aria-labelledby="habits-day-title"]')).not.toBeInTheDocument();
  });
});

describe('retired habits', () => {
  it('are gone from the list on a day they were never recorded', async () => {
    await seed({ name: 'Read', archivedAt: '2026-08-01T00:00:00.000Z' });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByText('Every habit is retired.')).toBeInTheDocument();
    expect(screen.queryByText('Read')).not.toBeInTheDocument();
  });

  it('still appear, read-only, on a day they were recorded', async () => {
    const user = userEvent.setup();
    const habit = await seed({ name: 'Read', archivedAt: '2026-08-01T00:00:00.000Z' });
    await createPluginRecord('habits', 'record', DATE, { values: { [habit.id]: 1 } });

    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    /* Behind the same disclosure the diary uses for hidden sub-entries: the day is a record, and
       hiding what happened would make it disagree with itself depending on when you looked. */
    await user.click(await screen.findByRole('button', { name: /1 retired habit recorded/ }));
    expect(await screen.findByText('Read')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Read' })).toBeDisabled();
  });
});
