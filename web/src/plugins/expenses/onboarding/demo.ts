import { addDays } from 'date-fns';
import { parseDateKey, toDateKey, todayKey } from '@/lib/dates';
import { builtinCategoryId, resolveCategories, type Expense } from '../model';
import { monthOf, shiftMonth } from '../stats';

/**
 * Made-up expenses for the tour, on real dates relative to today so the charts and the calendar
 * land where the real ones would. Deterministic — a tour that showed different numbers each time
 * it was opened would look like it was reading something.
 */

export const demoCategories = () => resolveCategories([]);

let nextId = 0;
const demoExpense = (
  dateKey: string,
  minor: number,
  description: string,
  category: Parameters<typeof builtinCategoryId>[0] | null,
): Expense => ({
  id: `demo-${nextId++}`,
  dateKey,
  minor,
  currency: 'EUR',
  description,
  category: category && builtinCategoryId(category),
  createdAt: `${dateKey}T${String(8 + (nextId % 12)).padStart(2, '0')}:00:00.000Z`,
});

/** Two things bought today, for the day card. Descriptions come from the locale, so they're passed
    in rather than written here. */
export function demoToday(names: { coffee: string; groceries: string }): Expense[] {
  const today = todayKey();
  return [
    demoExpense(today, 280, names.coffee, 'eatingOut'),
    demoExpense(today, 3415, names.groceries, 'groceries'),
  ];
}

/** Recurring shapes across the last twelve months — a few groceries a week, the odd meal out,
    transport, a monthly bill — with gentle variation so the columns aren't all the same height. */
export function demoYear(): Expense[] {
  const today = parseDateKey(todayKey());
  const expenses: Expense[] = [];
  const firstMonth = shiftMonth(monthOf(todayKey()), -11);
  for (let offset = 0; offset < 365; offset++) {
    const date = addDays(today, -offset);
    const dateKey = toDateKey(date);
    if (monthOf(dateKey) < firstMonth) break;
    const wave = 1 + 0.25 * Math.sin(offset / 29);
    if (offset % 3 === 0)
      expenses.push(demoExpense(dateKey, Math.round(2200 * wave), '', 'groceries'));
    if (offset % 6 === 2)
      expenses.push(demoExpense(dateKey, Math.round(1850 * wave), '', 'eatingOut'));
    if (offset % 4 === 1) expenses.push(demoExpense(dateKey, 240, '', 'transport'));
    if (date.getDate() === 1) expenses.push(demoExpense(dateKey, 6500, '', 'bills'));
    if (offset % 17 === 5)
      expenses.push(demoExpense(dateKey, Math.round(2400 * wave), '', 'leisure'));
  }
  return expenses;
}
