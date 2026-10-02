import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginCalendarDay, PluginCalendarViewProps } from '../types';
import { formatMinor } from './currency';
import type { Expense } from './model';
import { convertExpenses, useExchangeRates } from './rates';
import { sumByCurrency } from './stats';
import { resolveDisplayCurrency, useAllExpenses, useExpenseSettings } from './useExpenses';

/** Any day with an expense reads as *something*, however small, next to one with none. */
const MIN_LEVEL = 0.2;

/**
 * Shading for a day's spending, relative to the month on screen.
 *
 * Relative to the visible month rather than to all time, so each month shows its own shape — a
 * December doesn't wash every other month out to near-blank — and square-rooted, so one large
 * payment (rent, a flight) doesn't flatten the rest of the month to the same pale tint. What drives
 * the shade is the day's total in the page's display currency, every currency converted into it
 * (see rates.ts); a day whose spending has no exchange rate still gets the minimum shade, since
 * leaving it blank would say nothing happened. The tooltip names what was actually paid.
 */
export function levelFor(minor: number, max: number): number {
  if (minor <= 0 || max <= 0) return MIN_LEVEL;
  return MIN_LEVEL + (1 - MIN_LEVEL) * Math.sqrt(minor / max);
}

export function ExpensesCalendarView({ start, end, onData }: PluginCalendarViewProps) {
  const { t, i18n } = useTranslation();
  const { expenses } = useAllExpenses();
  const settings = useExpenseSettings();
  const display = useMemo(() => resolveDisplayCurrency(settings, expenses), [settings, expenses]);
  const rates = useExchangeRates(expenses.some((expense) => expense.currency !== display));

  useEffect(() => {
    const byDay = new Map<string, Expense[]>();
    for (const expense of expenses) {
      if (expense.dateKey < start || expense.dateKey > end) continue;
      const list = byDay.get(expense.dateKey) ?? [];
      list.push(expense);
      byDay.set(expense.dateKey, list);
    }

    const dayTotals = new Map(
      [...byDay].map(([day, list]) => [
        day,
        sumByCurrency(convertExpenses(list, display, rates).expenses).get(display) ?? 0,
      ]),
    );
    const max = Math.max(0, ...dayTotals.values());

    const data = new Map<string, PluginCalendarDay>();
    for (const [day, list] of byDay) {
      const amounts = [...sumByCurrency(list)]
        .map(([currency, minor]) => formatMinor(minor, currency, i18n.language))
        .join(' · ');
      data.set(day, {
        level: levelFor(dayTotals.get(day) ?? 0, max),
        label: t('plugins.expenses.calendarLabel', { amounts, count: list.length }),
      });
    }
    onData(data);
  }, [expenses, display, rates, start, end, onData, t, i18n.language]);

  return null;
}
