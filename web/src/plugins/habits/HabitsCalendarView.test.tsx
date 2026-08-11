import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createPluginRecord, putPluginRecord } from '@/db/pluginRecords';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import { HabitsCalendarView } from './HabitsCalendarView';
import en from './locales/en.json';
import { habitData, type Habit } from './model';

/* The calendar page's own view of the habit tracker: a day's shading is "how many of that day's
   habits were met", against the goal and the roster that applied *then* — not today's. */

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { habits: en } }, true, true);
  await db.pluginRecords.clear();
  await db.outbox.clear();
});

const seedHabit = (patch: Partial<Omit<Habit, 'id'>> & { name: string }) =>
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

const seedDay = (dateKey: string, values: Record<string, number>) =>
  putPluginRecord('habits', 'record', dateKey, { values });

type Ratio = { level: number; label: string };

const render = (start: string, end: string) => {
  const onData = vi.fn();
  renderWithProviders(<HabitsCalendarView start={start} end={end} onData={onData} />);
  return onData;
};

/** The map from the most recent call — but only once it actually holds `settledDay`, which is
    present only once Dexie's read has resolved. The mount fires `onData` once first with an empty
    map, straight from the hook's initial state, and reading `mock.calls.at(-1)` right after
    `toHaveBeenCalled()` races that first, still-empty call. */
const dataOnceSettled = async (
  onData: ReturnType<typeof vi.fn>,
  settledDay: string,
): Promise<Map<string, Ratio>> => {
  await waitFor(() => {
    const last = onData.mock.calls.at(-1)?.[0] as Map<string, Ratio> | undefined;
    expect(last?.has(settledDay)).toBe(true);
  });
  return onData.mock.calls.at(-1)![0] as Map<string, Ratio>;
};

describe('HabitsCalendarView', () => {
  it('reports nothing for a day no habit had been created yet', async () => {
    await seedHabit({ name: 'Read', since: '2026-08-15' });
    const onData = render('2026-08-01', '2026-08-31');

    // Waits for the 15th — the day the habit actually starts applying — to prove the load has
    // settled before checking that the 10th, before it existed, never appears.
    const data = await dataOnceSettled(onData, '2026-08-15');
    expect(data.has('2026-08-10')).toBe(false);
  });

  it('scores a day by how many of its applicable habits were met', async () => {
    const read = await seedHabit({ name: 'Read', since: '2026-08-01' });
    await seedHabit({ name: 'Run', since: '2026-08-01' }); // never recorded — the miss
    await seedDay('2026-08-10', { [read.id]: 1 }); // only Read done: 1 of 2

    const onData = render('2026-08-01', '2026-08-31');

    const data = await dataOnceSettled(onData, '2026-08-10');
    const day = data.get('2026-08-10');
    expect(day?.level).toBe(0.5);
    expect(day?.label).toBe('1/2');
  });

  it('judges a raised goal by what it was on the day, not today', async () => {
    const habit = await seedHabit({
      name: 'Push-ups',
      type: 'numeric',
      target: 100,
      since: '2026-08-15',
      revisions: [
        {
          since: '2026-08-01',
          changedAt: '2026-08-15T09:00:00.000Z',
          name: 'Push-ups',
          target: 50,
        },
      ],
    });
    // 50 push-ups on the 5th, when the goal was still 50 — met then, and must stay met.
    await seedDay('2026-08-05', { [habit.id]: 50 });

    const onData = render('2026-08-01', '2026-08-31');

    const data = await dataOnceSettled(onData, '2026-08-05');
    expect(data.get('2026-08-05')?.level).toBe(1);
  });

  it('drops a habit from the day after it was archived', async () => {
    await seedHabit({
      name: 'Read',
      since: '2026-08-01',
      archivedAt: '2026-08-10T12:00:00.000Z',
    });
    const onData = render('2026-08-01', '2026-08-31');

    // Still counted on the day it was archived...
    const data = await dataOnceSettled(onData, '2026-08-10');
    // ...but not the day after, so a month of "retired" days doesn't read as a month of misses.
    expect(data.has('2026-08-11')).toBe(false);
  });
});
