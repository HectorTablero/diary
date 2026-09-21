import { getDaysInMonth } from 'date-fns';
import { parseDateKey } from '@/lib/dates';
import type { Expense } from './model';

/**
 * Everything the page, the calendar and the tour compute from a list of expenses. Pure, and always
 * about *one* currency at a time — see currency.ts for why nothing here converts.
 *
 * What is deliberately absent: budgets, "over/under", month-on-month arrows. A number compared
 * against a target, or coloured by which direction it moved, is a verdict. The stats say what
 * happened and leave what to make of it to the person reading.
 */

/** `yyyy-MM` — the month a dateKey falls in. */
export const monthOf = (dateKey: string) => dateKey.slice(0, 7);

export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map(Number);
  const total = year * 12 + (monthIndex - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Every currency that appears, the default first and the rest by how often they're used. */
export function currenciesUsed(expenses: readonly Expense[], preferred: string): string[] {
  const counts = new Map<string, number>();
  for (const expense of expenses) {
    counts.set(expense.currency, (counts.get(expense.currency) ?? 0) + 1);
  }
  const others = [...counts.keys()]
    .filter((currency) => currency !== preferred)
    .sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
  return counts.has(preferred) || others.length === 0 ? [preferred, ...others] : others;
}

/** Total per currency, in the order currencies first appear. */
export function sumByCurrency(expenses: readonly Expense[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.minor);
  }
  return totals;
}

export interface MonthTotal {
  month: string;
  minor: number;
}

/** `count` consecutive months ending at `lastMonth`, oldest first — gaps included, as zero. */
export function monthlyTotals(
  expenses: readonly Expense[],
  currency: string,
  lastMonth: string,
  count = 12,
): MonthTotal[] {
  const first = shiftMonth(lastMonth, -(count - 1));
  const byMonth = new Map<string, number>();
  for (const expense of expenses) {
    if (expense.currency !== currency) continue;
    const month = monthOf(expense.dateKey);
    if (month < first || month > lastMonth) continue;
    byMonth.set(month, (byMonth.get(month) ?? 0) + expense.minor);
  }
  return Array.from({ length: count }, (_, i) => {
    const month = shiftMonth(first, i);
    return { month, minor: byMonth.get(month) ?? 0 };
  });
}

export interface CategoryTotal {
  /** Null for expenses filed under no category. */
  category: string | null;
  minor: number;
  count: number;
}

/** A month's spending per category, largest first. */
export function categoryBreakdown(
  expenses: readonly Expense[],
  currency: string,
  month: string,
): CategoryTotal[] {
  const totals = new Map<string | null, CategoryTotal>();
  for (const expense of expenses) {
    if (expense.currency !== currency || monthOf(expense.dateKey) !== month) continue;
    const current = totals.get(expense.category) ?? {
      category: expense.category,
      minor: 0,
      count: 0,
    };
    current.minor += expense.minor;
    current.count += 1;
    totals.set(expense.category, current);
  }
  return [...totals.values()].sort((a, b) => b.minor - a.minor);
}

export interface MonthSummary {
  total: number;
  count: number;
  /**
   * Per *counted* day, not per day with an expense — a quiet day is part of the month — but only
   * days the tracker was actually there for (see `countedDays`). Undefined when no day of the
   * month counts: one that hasn't started, or one the plugin was off for with nothing recorded.
   */
  dailyAverage: number | undefined;
  /** How many days the average is over — shown beside it, so a short one reads as short. */
  countedDays: number;
}

/** A stretch of days the plugin was switched on; see `ActivePeriod` in plugins/enabled.ts. */
export interface ActiveRange {
  from: string;
  to: string | null;
}

/**
 * Which days of `month` (up to `today`) an average should be taken over.
 *
 * A day counts if the plugin was switched on that day, or if anything was recorded on it (in any
 * currency) — an expense added later for a day the tracker was off is still a day with data, and
 * leaving it out would inflate the average. Days the tracker was off with nothing recorded are
 * left out: nothing was noted because nothing was noting, not because nothing was spent.
 *
 * With no recorded periods at all (a diary restored from a backup, say), the fallback is every day
 * from the first expense on.
 */
export function countedDays(
  expenses: readonly Expense[],
  month: string,
  today: string,
  periods: readonly ActiveRange[],
): number {
  const currentMonth = monthOf(today);
  if (month > currentMonth) return 0;
  const lastDay =
    month === currentMonth ? Number(today.slice(8)) : getDaysInMonth(parseDateKey(`${month}-01`));

  const withData = new Set<string>();
  let firstExpense: string | undefined;
  for (const expense of expenses) {
    if (monthOf(expense.dateKey) === month) withData.add(expense.dateKey);
    if (!firstExpense || expense.dateKey < firstExpense) firstExpense = expense.dateKey;
  }

  const active = (day: string) =>
    periods.length > 0
      ? periods.some((period) => day >= period.from && (period.to === null || day <= period.to))
      : firstExpense !== undefined && day >= firstExpense;

  let days = 0;
  for (let d = 1; d <= lastDay; d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`;
    if (withData.has(day) || active(day)) days += 1;
  }
  return days;
}

export function monthSummary(
  expenses: readonly Expense[],
  currency: string,
  month: string,
  today: string,
  periods: readonly ActiveRange[] = [],
): MonthSummary {
  let total = 0;
  let count = 0;
  for (const expense of expenses) {
    if (expense.currency !== currency || monthOf(expense.dateKey) !== month) continue;
    total += expense.minor;
    count += 1;
  }
  const days = countedDays(expenses, month, today, periods);
  return {
    total,
    count,
    dailyAverage: days > 0 ? Math.round(total / days) : undefined,
    countedDays: days,
  };
}

/** Per-day totals in one currency — what the calendar shades by. */
export function dailyTotals(expenses: readonly Expense[], currency: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    if (expense.currency !== currency) continue;
    totals.set(expense.dateKey, (totals.get(expense.dateKey) ?? 0) + expense.minor);
  }
  return totals;
}
