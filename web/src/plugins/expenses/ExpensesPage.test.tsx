import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addDays, format } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createPluginRecord } from '@/db/pluginRecords';
import i18n from '@/i18n';
import { formatDateKey, parseDateKey } from '@/lib/dates';
import { getPluginSettings, savePluginSettings } from '@/plugins/enabled';
import { renderWithProviders } from '@/test/renderWithProviders';
import ExpensesPage from './ExpensesPage';
import { ExpensesSettingsSection } from './ExpensesSettingsSection';
import en from './locales/en.json';
import { expenseData } from './model';
import { BUNDLED_RATES, resetRatesCache } from './rates';
import { addExpense, resetExpenseSettingsCache } from './useExpenses';

/* The page shows every currency combined into one by default, converted at cached rates, and can
   still show them separately. Rates come from localStorage here, seeded per test — the network is
   stubbed to fail, so nothing a test asserts depends on what the live source says today. */

/* Every date is relative to the snapshot built into the app, which CI refreshes: the cache seeded
   here is newer than it, so it is the one in use. */
const shift = (dateKey: string, days: number) =>
  format(addDays(parseDateKey(dateKey), days), 'yyyy-MM-dd');
const CACHED = shift(BUNDLED_RATES.date, 1);
const TODAY = shift(BUNDLED_RATES.date, 2);

const seedRates = (date: string, rates: Record<string, number>) =>
  localStorage.setItem(
    'expenses.exchangeRates',
    JSON.stringify({ date, rates, checkedAt: Date.now() }),
  );

const spend = (minor: number, currency: string, description: string) =>
  createPluginRecord(
    'expenses',
    'record',
    TODAY,
    expenseData({ minor, currency, description, category: null }),
  );

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { expenses: en } }, true, true);
  await i18n.changeLanguage('en');
  await db.pluginRecords.clear();
  await db.outbox.clear();
  localStorage.clear();
  resetExpenseSettingsCache();
  resetRatesCache();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline in tests')));
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00.000Z`) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ExpensesPage', () => {
  it('combines currencies into one total by default, and can show them separately', async () => {
    seedRates(CACHED, { EUR: 1, USD: 2 });
    await savePluginSettings('expenses', { currency: 'EUR' });
    await spend(1000, 'EUR', 'Lunch');
    await spend(1000, 'USD', 'Taxi');
    const user = userEvent.setup();
    renderWithProviders(<ExpensesPage />);

    // €10 + $10 at 2 USD/EUR = €15, in one figure.
    expect((await screen.findAllByText('€15.00')).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        `Other currencies converted at exchange rates from ${formatDateKey(CACHED, 'en', 'PPP')}.`,
      ),
    ).toBeInTheDocument();
    // The taxi still shows what was paid, with what it came to beneath.
    const taxi = screen.getByRole('button', { name: /Taxi/ });
    expect(within(taxi).getByText('$10.00')).toBeInTheDocument();
    expect(within(taxi).getByText('≈ €5.00')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Separately' }));
    await waitFor(async () => expect((await getPluginSettings('expenses')).view).toBe('separate'));
    expect(await screen.findByRole('tab', { name: 'USD' })).toBeInTheDocument();
    expect(screen.queryByText(/converted at exchange rates/)).not.toBeInTheDocument();
  });

  it('warns once the rates are more than a week old', async () => {
    seedRates(CACHED, { EUR: 1, USD: 2 });
    vi.setSystemTime(new Date(`${shift(CACHED, 8)}T12:00:00.000Z`));
    await savePluginSettings('expenses', { currency: 'EUR' });
    await spend(1000, 'EUR', 'Lunch');
    await spend(1000, 'USD', 'Taxi');
    renderWithProviders(<ExpensesPage />);

    expect(await screen.findByText(/more than a week ago/)).toBeInTheDocument();
    // Not offered over rates the page is already warning about.
    expect(screen.queryByRole('button', { name: /Exchange rates/ })).not.toBeInTheDocument();
  });

  it('explores rates against any currency, either way round', async () => {
    seedRates(CACHED, { EUR: 1, USD: 2, GBP: 0.5 });
    await savePluginSettings('expenses', { currency: 'EUR' });
    await spend(1000, 'EUR', 'Lunch');
    await spend(1000, 'USD', 'Taxi');
    const user = userEvent.setup();
    renderWithProviders(<ExpensesPage />);

    await user.click(await screen.findByRole('button', { name: /Exchange rates/ }));
    // The converter starts on the diary's foreign currency, into the display one: $1 is €0.50.
    expect(screen.getByRole('status')).toHaveTextContent('€0.50');

    // The diary's currencies against EUR, one of each in it…
    expect(screen.getByText('$1.00 = €0.50')).toBeInTheDocument();
    // …or one EUR in each.
    await user.click(screen.getByRole('tab', { name: '1 EUR in each' }));
    expect(screen.getByText('€1.00 = $2.00')).toBeInTheDocument();

    // Against another currency entirely: both of the diary's currencies are listed then.
    await user.click(screen.getByRole('button', { name: /Compared with Euro/ }));
    await user.click(await screen.findByRole('option', { name: /British Pound/ }));
    expect(await screen.findByText('£1.00 = €2.00')).toBeInTheDocument();
    expect(screen.getByText('£1.00 = $4.00')).toBeInTheDocument();
  });

  it('shows totals in the currency picked on the page', async () => {
    seedRates(CACHED, { EUR: 1, USD: 2 });
    await savePluginSettings('expenses', { currency: 'EUR', displayCurrency: 'USD' });
    await spend(1000, 'EUR', 'Lunch');
    renderWithProviders(<ExpensesPage />);

    // A single currency, shown in another: €10 is $20.
    expect((await screen.findAllByText('$20.00')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Totals shown in US Dollar/ })).toBeInTheDocument();
    // Nothing to show separately with only one currency in use.
    expect(screen.queryByRole('tab', { name: 'Separately' })).not.toBeInTheDocument();
  });
});

describe('default currency', () => {
  it('defaults to whatever was used last, and remembers each new one', async () => {
    renderWithProviders(<ExpensesSettingsSection />);
    expect(await screen.findByText('Whatever I used last')).toBeInTheDocument();

    await addExpense(TODAY, {
      minor: 500,
      currency: 'JPY',
      description: '',
      category: null,
    });
    await waitFor(async () =>
      expect((await getPluginSettings('expenses')).lastCurrency).toBe('JPY'),
    );
    expect(await screen.findByText('JPY')).toBeInTheDocument();
  });

  it('keeps a currency picked before "last used" existed', async () => {
    await savePluginSettings('expenses', { currency: 'GBP' });
    renderWithProviders(<ExpensesSettingsSection />);
    expect(await screen.findByText('British Pound')).toBeInTheDocument();
    expect(screen.queryByText('Whatever I used last')).not.toBeInTheDocument();
  });
});
