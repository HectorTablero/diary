import { UNDATED_KEY, type PluginRecordDto } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import { formatMinor, guessCurrency, minorToInput, parseAmountInput } from './currency';
import {
  builtinCategoryId,
  categoryData,
  expenseData,
  parseExpense,
  resolveCategories,
} from './model';
import type { Expense } from './model';
import {
  categoryBreakdown,
  countedDays,
  currenciesUsed,
  monthlyTotals,
  monthSummary,
  shiftMonth,
} from './stats';

const row = (
  data: Record<string, unknown>,
  dateKey = '2026-09-10',
  extra: Partial<PluginRecordDto> = {},
): PluginRecordDto => ({
  id: `row-${Math.random()}`,
  pluginId: 'expenses',
  scope: 'record',
  dateKey,
  data,
  createdAt: '2026-09-10T10:00:00.000Z',
  updatedAt: '2026-09-10T10:00:00.000Z',
  ...extra,
});

const expense = (dateKey: string, minor: number, extra: Partial<Expense> = {}): Expense => ({
  id: `${dateKey}-${minor}`,
  dateKey,
  minor,
  currency: 'EUR',
  description: '',
  category: null,
  createdAt: `${dateKey}T10:00:00.000Z`,
  ...extra,
});

describe('parseAmountInput', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12.50', 1250],
    ['0,99', 99],
    ['1.234,50', 123450],
    ['1,234.50', 123450],
    ['1.200', 120000], // three digits after the only separator: grouping, not decimals
    ['12,345', 1234500],
    ['1.234.567', 123456700],
    ['1 200,00', 120000],
    ['12.', 1200],
  ])('reads %s as %d cents', (input, minor) => {
    expect(parseAmountInput(input, 'EUR')).toBe(minor);
  });

  it.each(['', 'abc', '0', '0,00', '-5', '12,3456', '1.2.3', '1.23.456'])('refuses %j', (input) => {
    expect(parseAmountInput(input, 'EUR')).toBeUndefined();
  });

  it('uses the currency’s own minor unit', () => {
    expect(parseAmountInput('1200', 'JPY')).toBe(1200);
    expect(parseAmountInput('1.200', 'JPY')).toBe(1200);
    expect(parseAmountInput('12.5', 'JPY')).toBeUndefined();
    expect(parseAmountInput('1,5', 'KWD')).toBe(1500);
  });

  it('round-trips through the edit field', () => {
    expect(parseAmountInput(minorToInput(123456, 'EUR', 'es'), 'EUR')).toBe(123456);
    expect(parseAmountInput(minorToInput(123456, 'EUR', 'en'), 'EUR')).toBe(123456);
  });
});

describe('formatMinor', () => {
  it('formats in the reader’s locale with the currency’s decimals', () => {
    expect(formatMinor(1250, 'EUR', 'en')).toBe('€12.50');
    expect(formatMinor(1200, 'JPY', 'en')).toBe('¥1,200');
  });
});

describe('guessCurrency', () => {
  it('prefers the region, then the language, then euros', () => {
    expect(guessCurrency(['en-GB'])).toBe('GBP');
    expect(guessCurrency(['es-MX', 'es'])).toBe('MXN');
    expect(guessCurrency(['ja'])).toBe('JPY');
    expect(guessCurrency(['xx'])).toBe('EUR');
  });
});

describe('parseExpense', () => {
  it('reads what expenseData writes', () => {
    const parsed = parseExpense(
      row(expenseData({ minor: 350, currency: 'EUR', description: ' Coffee ', category: null })),
    );
    expect(parsed).toMatchObject({ minor: 350, currency: 'EUR', description: 'Coffee' });
  });

  it('ignores category rows, undated rows and nonsense', () => {
    expect(parseExpense(row(categoryData({ builtin: null, name: 'Pets', retired: false })))).toBe(
      undefined,
    );
    expect(parseExpense(row({ kind: 'expense', minor: 5, currency: 'EUR' }, UNDATED_KEY))).toBe(
      undefined,
    );
    expect(parseExpense(row({ kind: 'expense', minor: 1.5, currency: 'EUR' }))).toBeUndefined();
    expect(parseExpense(row({ kind: 'expense', minor: 5, currency: 'XYZW' }))).toBeUndefined();
  });

  it('keeps an expense whose optional fields are malformed', () => {
    const parsed = parseExpense(
      row({ kind: 'expense', minor: 5, currency: 'EUR', description: 7, category: {} }),
    );
    expect(parsed).toMatchObject({ minor: 5, description: '', category: null });
  });
});

describe('resolveCategories', () => {
  it('lists the starters without any rows at all', () => {
    const categories = resolveCategories([]);
    expect(categories[0]).toMatchObject({
      id: builtinCategoryId('groceries'),
      name: null,
      retired: false,
      rowId: null,
    });
  });

  it('applies the newest override of a starter, and appends custom ones in creation order', () => {
    const older = row(
      categoryData({ builtin: 'groceries', name: 'Food', retired: false }),
      UNDATED_KEY,
      { id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' },
    );
    const newer = row(
      categoryData({ builtin: 'groceries', name: 'Supermarket', retired: true }),
      UNDATED_KEY,
      { id: 'b', updatedAt: '2026-02-01T00:00:00.000Z' },
    );
    const pets = row(categoryData({ builtin: null, name: 'Pets', retired: false }), UNDATED_KEY, {
      id: 'pets',
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    const books = row(categoryData({ builtin: null, name: 'Books', retired: false }), UNDATED_KEY, {
      id: 'books',
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    const categories = resolveCategories([pets, newer, older, books]);
    expect(categories.find((c) => c.builtinKey === 'groceries')).toMatchObject({
      name: 'Supermarket',
      retired: true,
      rowId: 'b',
    });
    expect(categories.slice(-2).map((c) => c.name)).toEqual(['Books', 'Pets']);
  });
});

describe('stats', () => {
  const expenses = [
    expense('2026-08-03', 1000),
    expense('2026-09-01', 500, { category: 'food' }),
    expense('2026-09-10', 1500, { category: 'food' }),
    expense('2026-09-10', 700),
    expense('2026-09-11', 9900, { currency: 'USD' }),
  ];

  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-09', -11)).toBe('2025-10');
  });

  it('lists the default currency first, then others by use', () => {
    expect(currenciesUsed(expenses, 'EUR')).toEqual(['EUR', 'USD']);
    expect(currenciesUsed([], 'EUR')).toEqual(['EUR']);
    // A default nobody has used yet is not offered as an empty tab.
    expect(currenciesUsed([expense('2026-09-01', 1, { currency: 'GBP' })], 'EUR')).toEqual(['GBP']);
  });

  it('totals twelve months, gaps included, one currency only', () => {
    const totals = monthlyTotals(expenses, 'EUR', '2026-09');
    expect(totals).toHaveLength(12);
    expect(totals[0].month).toBe('2025-10');
    expect(totals.at(-2)).toEqual({ month: '2026-08', minor: 1000 });
    expect(totals.at(-1)).toEqual({ month: '2026-09', minor: 2700 });
  });

  it('breaks a month down by category, largest first', () => {
    expect(categoryBreakdown(expenses, 'EUR', '2026-09')).toEqual([
      { category: 'food', minor: 2000, count: 2 },
      { category: null, minor: 700, count: 1 },
    ]);
  });

  it('averages over the days so far in the current month', () => {
    expect(monthSummary(expenses, 'EUR', '2026-09', '2026-09-10')).toEqual({
      total: 2700,
      count: 3,
      dailyAverage: 270,
      countedDays: 10,
    });
    expect(monthSummary(expenses, 'EUR', '2026-10', '2026-09-10').dailyAverage).toBeUndefined();
  });

  it('with no recorded periods, counts from the first expense on', () => {
    // August 3rd is the first expense ever: the 1st and 2nd were before the tracker was in use.
    expect(countedDays(expenses, '2026-08', '2026-09-10', [])).toBe(29);
  });

  it('counts only days the plugin was on — plus any day that has data regardless', () => {
    const periods = [
      { from: '2026-08-01', to: '2026-08-05' },
      { from: '2026-08-20', to: null },
    ];
    // 1–5 and 20–31 are on (5 + 12). Off from the 6th to the 19th, but an expense was added later
    // for the 10th, so that one counts too.
    const withGapExpense = [...expenses, expense('2026-08-10', 400, { currency: 'USD' })];
    expect(countedDays(withGapExpense, '2026-08', '2026-09-10', periods)).toBe(18);
    expect(countedDays(expenses, '2026-08', '2026-09-10', periods)).toBe(17);

    // A month the plugin was entirely off for, with nothing recorded, has no average at all.
    expect(
      monthSummary(expenses, 'EUR', '2026-07', '2026-09-10', periods).dailyAverage,
    ).toBeUndefined();
  });
});
