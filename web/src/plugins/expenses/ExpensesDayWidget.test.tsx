import 'fake-indexeddb/auto';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createPluginRecord } from '@/db/pluginRecords';
import i18n from '@/i18n';
import { savePluginSettings } from '@/plugins/enabled';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ExpensesDayWidget } from './ExpensesDayWidget';
import en from './locales/en.json';
import { expenseData, parseExpense } from './model';
import { resetDefaultCurrencyCache } from './useExpenses';

/* The card follows the other plugins' rule — today is open, the past is locked until deliberately
   opened, the future isn't there — plus one of its own: a past day with nothing on it gets a quiet
   button rather than a whole card. */

const TODAY = '2026-08-10';
const PAST = '2026-08-05';
const FUTURE = '2026-08-15';

const seed = (dateKey: string, minor: number, description: string) =>
  createPluginRecord(
    'expenses',
    'record',
    dateKey,
    expenseData({ minor, currency: 'EUR', description, category: null }),
  );

const expensesOn = async (dateKey: string) =>
  (await db.pluginRecords.where('[pluginId+dateKey]').equals(['expenses', dateKey]).toArray())
    .map(parseExpense)
    .filter((expense) => expense !== undefined);

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { expenses: en } }, true, true);
  await i18n.changeLanguage('en');
  await db.pluginRecords.clear();
  await db.outbox.clear();
  resetDefaultCurrencyCache();
  await savePluginSettings('expenses', { currency: 'EUR' });
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00.000Z`) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ExpensesDayWidget', () => {
  it('adds an expense on today, with only an amount required', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExpensesDayWidget dateKey={TODAY} />);

    const amount = await screen.findByRole('textbox', { name: 'Amount' });
    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();

    await user.type(amount, '3,20');
    await user.click(add);

    await waitFor(async () => {
      expect(await expensesOn(TODAY)).toMatchObject([{ minor: 320, currency: 'EUR' }]);
    });
    // Cleared for the next one, and the total is in the header.
    await waitFor(() => expect(amount).toHaveValue(''));
    expect(
      await screen.findByRole('button', { name: 'Edit No category, €3.20' }),
    ).toBeInTheDocument();
  });

  it('opens a past day with expenses locked, and unlocks on request', async () => {
    const user = userEvent.setup();
    await seed(PAST, 1250, 'Lunch');
    renderWithProviders(<ExpensesDayWidget dateKey={PAST} />);

    expect(await screen.findByText('Lunch')).toBeInTheDocument();
    // Locked: no form, and the row is text rather than a button.
    expect(screen.queryByRole('textbox', { name: 'Amount' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Lunch/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unlock this day' }));
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Lunch, €12.50' })).toBeInTheDocument();
  });

  it('offers a quiet button on an empty past day, which opens the card unlocked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExpensesDayWidget dateKey={PAST} />);

    const open = await screen.findByRole('button', { name: 'Add an expense for this day' });
    expect(screen.queryByRole('heading', { name: 'Expenses' })).not.toBeInTheDocument();

    await user.click(open);
    expect(screen.getByRole('heading', { name: 'Expenses' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lock this day' })).toBeInTheDocument();
  });

  it('shows the full card when moving between two past days that both have expenses', async () => {
    // The regression: the "opened" flag was reset on navigation and only set again when the
    // *number* of expenses changed, so one past day with an expense followed by another showed the
    // empty-day button on the second.
    const user = userEvent.setup();
    const OTHER_PAST = '2026-08-04';
    await seed(PAST, 1250, 'Lunch');
    await seed(OTHER_PAST, 600, 'Bus');

    function Navigator() {
      const [day, setDay] = useState(PAST);
      return (
        <>
          <Button onClick={() => setDay(OTHER_PAST)}>previous day</Button>
          <ExpensesDayWidget dateKey={day} />
        </>
      );
    }
    renderWithProviders(<Navigator />);

    expect(await screen.findByText('Lunch')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unlock this day' }));
    await user.click(screen.getByRole('button', { name: 'previous day' }));

    expect(await screen.findByText('Bus')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add an expense for this day' }),
    ).not.toBeInTheDocument();
    // And the unlock belonged to the other day.
    expect(screen.getByRole('button', { name: 'Unlock this day' })).toBeInTheDocument();
  });

  it('shows nothing on a future day', async () => {
    renderWithProviders(<ExpensesDayWidget dateKey={FUTURE} />);
    // Let the reads settle, then confirm nothing was drawn — not even the quiet past-day button.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('heading', { name: 'Expenses' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('deletes with an undo', async () => {
    const user = userEvent.setup();
    await seed(TODAY, 800, 'Taxi');
    renderWithProviders(<ExpensesDayWidget dateKey={TODAY} />);

    await user.click(await screen.findByRole('button', { name: 'Edit Taxi, €8.00' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(async () => expect(await expensesOn(TODAY)).toHaveLength(0));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      expect(await expensesOn(TODAY)).toMatchObject([{ minor: 800, description: 'Taxi' }]);
    });
  });
});
