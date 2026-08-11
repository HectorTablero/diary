import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createPluginRecord } from '@/db/pluginRecords';
import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import { renderWithProviders } from '@/test/renderWithProviders';
import { HabitsDayWidget } from './HabitsDayWidget';
import en from './locales/en.json';
import { habitData, type Habit } from './model';

/* Every day but today opens read-only, behind a padlock that can be tapped open. The point is
   friction at the moment of editing history or the future, not a permanent restriction — so what
   matters here is that the default is locked, that unlocking actually works, and that it resets
   rather than being remembered. */

const TODAY = '2026-08-10';
const PAST = '2026-08-05';
const FUTURE = '2026-08-15';

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
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00.000Z`) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('today', () => {
  it('has no lock button, and every control starts enabled', async () => {
    await seed({ name: 'Read' });
    renderWithProviders(<HabitsDayWidget dateKey={TODAY} />);

    expect(await screen.findByRole('checkbox', { name: 'Read' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Unlock this day' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock this day' })).not.toBeInTheDocument();
  });
});

describe.each([
  ['a past day', PAST],
  ['a future day', FUTURE],
])('%s', (_label, dateKey) => {
  it('opens locked, with every control disabled and a lock button offered', async () => {
    await seed({ name: 'Read' });
    renderWithProviders(<HabitsDayWidget dateKey={dateKey} />);

    expect(await screen.findByRole('checkbox', { name: 'Read' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Unlock this day' })).toBeInTheDocument();
  });

  it('unlocks on tap, enabling every control and offering to lock again', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Read' });
    renderWithProviders(<HabitsDayWidget dateKey={dateKey} />);

    await user.click(await screen.findByRole('button', { name: 'Unlock this day' }));

    expect(screen.getByRole('checkbox', { name: 'Read' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Lock this day' })).toBeInTheDocument();
  });

  it('can actually be recorded once unlocked', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Read' });
    renderWithProviders(<HabitsDayWidget dateKey={dateKey} />);

    await user.click(await screen.findByRole('button', { name: 'Unlock this day' }));
    await user.click(screen.getByRole('checkbox', { name: 'Read' }));

    await waitFor(async () => expect(Object.keys(await valuesOn(dateKey))).toHaveLength(1));
  });

  it('locks again on tap, disabling every control once more', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Read' });
    renderWithProviders(<HabitsDayWidget dateKey={dateKey} />);

    await user.click(await screen.findByRole('button', { name: 'Unlock this day' }));
    await user.click(screen.getByRole('button', { name: 'Lock this day' }));

    expect(screen.getByRole('checkbox', { name: 'Read' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Unlock this day' })).toBeInTheDocument();
  });
});

/** Switches between two dates without ever unmounting the provider tree — `rerender` from
    `renderWithProviders` would swap the *whole* tree, providers included, so it cannot stand in
    for the app re-rendering the same mounted widget with a new `dateKey` prop. */
function DateSwitcher({ from, to }: { from: string; to: string }) {
  const [dateKey, setDateKey] = useState(from);
  return (
    <>
      <Button onClick={() => setDateKey(to)}>Switch date</Button>
      <HabitsDayWidget dateKey={dateKey} />
    </>
  );
}

describe('switching days', () => {
  it('locks again on a different day, rather than remembering an unlock', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Read' });
    renderWithProviders(<DateSwitcher from={PAST} to={FUTURE} />);

    await user.click(await screen.findByRole('button', { name: 'Unlock this day' }));
    expect(screen.getByRole('checkbox', { name: 'Read' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Switch date' }));

    expect(await screen.findByRole('button', { name: 'Unlock this day' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Read' })).toBeDisabled();
  });
});

describe('the tooltip explaining why a day is locked', () => {
  it('differs between a past day and a future one', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Read' });
    renderWithProviders(<DateSwitcher from={PAST} to={FUTURE} />);

    await user.hover(await screen.findByRole('button', { name: 'Unlock this day' }));
    expect(
      await screen.findByText(
        'This day is in the past, so values are locked. Tap to make changes.',
      ),
    ).toBeInTheDocument();
    await user.unhover(screen.getByRole('button', { name: 'Unlock this day' }));

    await user.click(screen.getByRole('button', { name: 'Switch date' }));

    await user.hover(await screen.findByRole('button', { name: 'Unlock this day' }));
    expect(
      await screen.findByText(
        "This day hasn't happened yet, so values are locked. Tap to make changes.",
      ),
    ).toBeInTheDocument();
  });
});
