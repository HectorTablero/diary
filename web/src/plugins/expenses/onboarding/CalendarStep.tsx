import { addDays, getDay } from 'date-fns';
import { BookOpen, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseDateKey, toDateKey, todayKey, weekdayName } from '@/lib/dates';
import { useWeekStart } from '@/lib/preferences';
import { pluginHeatmapBg, useIsDark } from '@/pages/CalendarPage';
import { findPlugin } from '@/plugins/registry';
import { levelFor } from '../ExpensesCalendarView';
import { dailyTotals } from '../stats';
import { demoYear } from './demo';

/** How far back the preview grid reaches — three weeks, ending on this week. */
const WEEKS = 3;

/**
 * A preview of the calendar tab: the same demo year the stats step charts, the last three weeks of
 * it, shaded by `levelFor` — the calendar view's own rule — in the plugin's own hue. The switcher is
 * real but pinned, as in the other plugins' tours: there is no entries heatmap behind "Entries" to
 * switch to here.
 */
export function CalendarStep() {
  const { t, i18n } = useTranslation();
  const isDark = useIsDark();
  const weekStart = useWeekStart();
  const hue = findPlugin('expenses')?.hue;

  const { cells, totals, max } = useMemo(() => {
    const today = parseDateKey(todayKey());
    const trailing = (weekStart + 6 - getDay(today) + 7) % 7;
    const last = addDays(today, trailing);
    const first = addDays(last, -(WEEKS * 7 - 1));
    const keys: string[] = [];
    for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1))
      keys.push(toDateKey(cursor));
    const byDay = dailyTotals(demoYear(), 'EUR');
    const visible = keys.map((key) => byDay.get(key) ?? 0);
    return { cells: keys, totals: byDay, max: Math.max(0, ...visible) };
  }, [weekStart]);

  const today = todayKey();
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    weekdayName((weekStart + i) % 7, i18n.language, 'EEEEEE'),
  );

  return (
    <div className="flex flex-col gap-3">
      <Tabs value="expenses">
        <TabsList>
          <TabsTrigger value="entries" disabled className="gap-1.5">
            <BookOpen className="size-3.5" aria-hidden />
            {t('calendar.entries')}
          </TabsTrigger>
          <TabsTrigger value="expenses" className="gap-1.5">
            <Wallet className="size-3.5" aria-hidden />
            {t('plugins.expenses.name')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-xl border bg-card p-3 shadow-xs">
        <div className="mb-1 grid grid-cols-7 gap-0.5">
          {weekdays.map((day, i) => (
            <div
              key={i}
              className="py-1 text-center text-[11px] font-medium text-muted-foreground uppercase"
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((dateKey) => {
            const minor = dateKey <= today ? (totals.get(dateKey) ?? 0) : 0;
            return (
              <div
                key={dateKey}
                className="flex h-10 w-full items-center justify-center rounded-lg text-[13px] text-muted-foreground"
                style={
                  minor > 0
                    ? { backgroundColor: pluginHeatmapBg(levelFor(minor, max), isDark, hue) }
                    : undefined
                }
              >
                {Number(dateKey.slice(8))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
