import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayKey } from '@/lib/dates';
import { CategoryBars, MonthlyColumns, MonthProgress } from '../charts';
import { SummaryCard } from '../ExpensesPage';
import { categoryBreakdown, monthlyTotals, monthOf, monthSummary } from '../stats';
import { demoCategories, demoYear } from './demo';

/**
 * The plugin page's figures and both charts, over a made-up year — the real components, and live:
 * picking a column moves the figures and the category breakdown to that month, which is the one
 * thing on the page worth trying before there's any data of one's own.
 */
export function StatsStep() {
  const { t } = useTranslation();
  const today = todayKey();
  const currentMonth = monthOf(today);
  const expenses = useMemo(demoYear, []);
  const byId = useMemo(() => new Map(demoCategories().map((c) => [c.id, c])), []);
  const [month, setMonth] = useState(currentMonth);

  return (
    <div className="flex flex-col gap-3">
      <SummaryCard summary={monthSummary(expenses, 'EUR', month, today)} currency="EUR" />
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <MonthProgress expenses={expenses} currency="EUR" month={month} today={today} />
      </div>
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <MonthlyColumns
          totals={monthlyTotals(expenses, 'EUR', currentMonth)}
          currency="EUR"
          selected={month}
          lastSelectable={currentMonth}
          onSelect={setMonth}
        />
      </div>
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <CategoryBars
          breakdown={categoryBreakdown(expenses, 'EUR', month)}
          byId={byId}
          currency="EUR"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t('plugins.expenses.onboarding.previewNote')}
      </p>
    </div>
  );
}
