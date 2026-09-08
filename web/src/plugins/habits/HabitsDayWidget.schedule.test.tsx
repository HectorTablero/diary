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
import { habitData, valueData, type Habit } from './model';

/* Which habits a day actually asks about, on the surface where it matters.
 *
 * The arithmetic behind this is covered in schedule.test.ts and tasks.test.ts; what is asserted
 * here is that the day card asks the same questions those files answer — that a habit set for
 * Tuesdays is genuinely absent on a Monday rather than merely unticked, and that a task nobody did
 * on Friday is still on the card the following Monday, saying so.
 *
 * DATE is a **Monday**, pinned as today: everything here is about today, so the day lock (which
 * covers every other day) never comes into it. */
const DATE = '2026-08-10';
const PREVIOUS_FRIDAY = '2026-08-07';

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

const record = (dateKey: string, values: Record<string, number>) =>
  createPluginRecord('habits', 'record', dateKey, valueData(values));

const valuesOn = async (dateKey: string) => {
  const row = await db.pluginRecords
    .where('[pluginId+dateKey]')
    .equals(['habits', dateKey])
    .first();
  return ((row?.data as { values?: Record<string, number> } | undefined)?.values ?? {}) as Record<
    string,
    number
  >;
};

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

describe('a habit with a schedule', () => {
  it('is asked about on its own days', async () => {
    await seed({ name: 'Gym', schedule: { kind: 'weekdays', days: [1, 4] } }); // Mon, Thu
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByRole('checkbox', { name: 'Gym' })).toBeInTheDocument();
  });

  it('is absent on the days it is not, rather than sitting there unticked', async () => {
    /* The distinction the whole feature turns on. An untouched box on a Monday for a habit that is
       only ever done on Tuesdays is a question the day never asked, and leaving it there would
       make the card's own 0/1 counter a lie about the day. */
    await seed({ name: 'Gym', schedule: { kind: 'weekdays', days: [2] } }); // Tuesdays
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByText('Nothing to track on this day.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Gym' })).not.toBeInTheDocument();
  });

  it('says nothing is scheduled rather than claiming every habit is retired', async () => {
    // Two very different pieces of news, and only one of them is true here: the habit is alive and
    // well, it simply does not happen on Mondays.
    await seed({ name: 'Gym', schedule: { kind: 'weekdays', days: [2] } });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByText('Nothing to track on this day.')).toBeInTheDocument();
    expect(screen.queryByText('Every habit is retired.')).not.toBeInTheDocument();
  });

  it('still shows a day that was answered off-schedule', async () => {
    /* Recorded on a Monday, then narrowed to Tuesdays. The value exists and is part of the diary;
       hiding it would make the day disagree with what is stored on it. */
    const habit = await seed({ name: 'Gym', schedule: { kind: 'weekdays', days: [2] } });
    await record(DATE, { [habit.id]: 1 });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByRole('checkbox', { name: 'Gym' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('a task left undone', () => {
  it('is still on the card days later, marked overdue and dated from when it was owed', async () => {
    await seed({ name: 'Renew the passport', type: 'task', since: PREVIOUS_FRIDAY });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByRole('checkbox', { name: 'Renew the passport' })).toBeInTheDocument();
    // The word is for the eye; the date it has been waiting since is what is read aloud.
    expect(screen.getByLabelText('Overdue since Friday, August 7th, 2026')).toBeInTheDocument();
  });

  it('is recorded against the day it was actually done, not the day it was due', async () => {
    const habit = await seed({
      name: 'Renew the passport',
      type: 'task',
      since: PREVIOUS_FRIDAY,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Renew the passport' }));

    // Monday is where it happened, so Monday is where the diary says it happened.
    await waitFor(async () => expect(await valuesOn(DATE)).toEqual({ [habit.id]: 1 }));
    expect(await valuesOn(PREVIOUS_FRIDAY)).toEqual({});
  });

  it('keeps saying what it was overdue from while it is being ticked', async () => {
    /* The pill is derived from settled history and never from today's own value, so it does not
       blink out from under the finger that just pressed the button beside it — the same rule the
       streak badge follows. */
    await seed({ name: 'Renew the passport', type: 'task', since: PREVIOUS_FRIDAY });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Renew the passport' }));

    expect(screen.getByLabelText('Overdue since Friday, August 7th, 2026')).toBeInTheDocument();
  });
});

describe('a task already done', () => {
  it('stops being asked about', async () => {
    const habit = await seed({
      name: 'Renew the passport',
      type: 'task',
      since: PREVIOUS_FRIDAY,
    });
    await record(PREVIOUS_FRIDAY, { [habit.id]: 1 });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByText('Nothing to track on this day.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Renew the passport' })).not.toBeInTheDocument();
  });

  it('comes back on its next occurrence when it repeats', async () => {
    // Mondays. Done last Friday, which cleared the occurrence outstanding then; today is a new one.
    const habit = await seed({
      name: 'Take the bins out',
      type: 'task',
      since: '2026-08-03',
      schedule: { kind: 'weekdays', days: [1] },
    });
    await record(PREVIOUS_FRIDAY, { [habit.id]: 1 });
    renderWithProviders(<HabitsDayWidget dateKey={DATE} />);

    expect(await screen.findByRole('checkbox', { name: 'Take the bins out' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // Due today, so no pill: it has not been waiting for anything.
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });
});
