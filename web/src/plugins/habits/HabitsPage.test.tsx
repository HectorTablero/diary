import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createPluginRecord } from '@/db/pluginRecords';
import i18n from '@/i18n';
import { todayKey } from '@/lib/dates';
import { renderWithProviders } from '@/test/renderWithProviders';
import HabitsPage from './HabitsPage';
import en from './locales/en.json';
import { habitData, parseHabit, type Habit } from './model';

/* The rule this page exists to enforce: a habit that has ever been recorded cannot be deleted, only
   retired. The days it happened on are diary history, and losing them to a tidy-up would be
   unrecoverable and invisible. */

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

const definitions = async () =>
  (await db.pluginRecords.where('[pluginId+scope]').equals(['habits', 'record']).toArray())
    .filter((row) => row.dateKey === UNDATED_KEY)
    .flatMap((row) => parseHabit(row) ?? []);

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { habits: en } }, true, true);
  await db.pluginRecords.clear();
  await db.outbox.clear();
});

describe('creating a habit', () => {
  it('makes a tick-box habit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HabitsPage />);

    await user.click(await screen.findByRole('button', { name: 'New habit' }));
    await user.type(screen.getByLabelText('Habit name'), 'Read');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(async () => expect(await definitions()).toHaveLength(1));
    expect((await definitions())[0]).toMatchObject({ name: 'Read', type: 'binary' });
  });

  it('makes a counted habit with a unit and a goal', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HabitsPage />);

    await user.click(await screen.findByRole('button', { name: 'New habit' }));
    await user.type(screen.getByLabelText('Habit name'), 'Push-ups');
    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'A number' }));
    await user.type(screen.getByLabelText('Unit'), 'reps');
    await user.type(screen.getByLabelText('Daily goal'), '30');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(async () => expect(await definitions()).toHaveLength(1));
    expect((await definitions())[0]).toMatchObject({
      name: 'Push-ups',
      type: 'numeric',
      unit: 'reps',
      target: 30,
    });
  });
});

describe('deleting versus retiring', () => {
  it('offers delete for a habit that was never recorded', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Read' });
    renderWithProviders(<HabitsPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    // Nothing to protect: no day ever mentioned it.
    await waitFor(async () => expect(await definitions()).toHaveLength(0));
  });

  it('offers only retire once a habit has been recorded', async () => {
    const habit = await seed({ name: 'Read' });
    await createPluginRecord('habits', 'record', todayKey(), { values: { [habit.id]: 1 } });

    renderWithProviders(<HabitsPage />);

    expect(await screen.findByRole('button', { name: 'Retire' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('keeps the habit and its history when retired', async () => {
    const user = userEvent.setup();
    const habit = await seed({ name: 'Read' });
    await createPluginRecord('habits', 'record', todayKey(), { values: { [habit.id]: 1 } });
    renderWithProviders(<HabitsPage />);

    await user.click(await screen.findByRole('button', { name: 'Retire' }));

    // Still there, now archived — and the day that recorded it is untouched.
    await waitFor(async () => expect((await definitions())[0]?.archivedAt).not.toBeNull());
    expect(
      await db.pluginRecords.where('[pluginId+dateKey]').equals(['habits', todayKey()]).count(),
    ).toBe(1);
  });
});

describe('the other kinds', () => {
  it('makes a timed habit, whose goal is entered in minutes and stored in seconds', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HabitsPage />);

    await user.click(await screen.findByRole('button', { name: 'New habit' }));
    await user.type(screen.getByLabelText('Habit name'), 'Reading');
    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'Time spent' }));
    await user.type(screen.getByLabelText('Daily goal (minutes)'), '30');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    /* Seconds, because the stopwatch produces them: pausing at 14:09 and resuming later has to
       resume from 14:09, not a rounded 14:00 that loses nine seconds every time. */
    await waitFor(async () => expect(await definitions()).toHaveLength(1));
    expect((await definitions())[0]).toMatchObject({ type: 'time', target: 1800 });
  });

  it('makes a rating with its own bounds', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HabitsPage />);

    await user.click(await screen.findByRole('button', { name: 'New habit' }));
    await user.type(screen.getByLabelText('Habit name'), 'Sleep quality');
    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'A rating' }));
    await user.type(screen.getByLabelText('Lowest'), '1');
    await user.type(screen.getByLabelText('Highest'), '10');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(async () => expect(await definitions()).toHaveLength(1));
    expect((await definitions())[0]).toMatchObject({ type: 'scale', min: 1, max: 10 });
  });
});

describe('retired habits', () => {
  it('are behind a disclosure, and can be brought back', async () => {
    const user = userEvent.setup();
    await seed({ name: 'Read', archivedAt: '2026-08-01T00:00:00.000Z' });
    renderWithProviders(<HabitsPage />);

    const toggle = await screen.findByRole('button', { name: /1 retired habit/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    const card = within(await screen.findByRole('region', { name: 'Read' }));
    await user.click(card.getByRole('button', { name: 'Bring back' }));

    await waitFor(async () => expect((await definitions())[0]?.archivedAt).toBeNull());
  });
});
