import { addDays, getDay } from 'date-fns';
import { BookOpen, Droplet } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseDateKey, toDateKey, todayKey, weekdayName } from '@/lib/dates';
import { useWeekStart } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { pluginHeatmapBg, useIsDark } from '@/pages/CalendarPage';
import { findPlugin } from '@/plugins/registry';
import { CALENDAR_LEVEL, PREDICTED_CALENDAR_LEVEL } from '../model';
import { demoCycle } from './demoCycle';

/** ~28 days after the cycle CyclePageStep shows, the way `predictNext` would guess at a plain
    average — future relative to today, since a prediction that isn't is not what the word means,
    and close enough to read as "coming up" without borrowing `outlookFor`'s own arithmetic for a
    date that was never really logged. Four days wide, `predict.ts`'s own default period length. */
const PREDICTED_DAYS = 4;

/**
 * A preview of the period tracker's calendar view — CalendarPage.tsx's plugin tab, shaded with the
 * app's own `pluginHeatmapBg` and this plugin's own reddish hue (`findPlugin('period-tracker').hue`,
 * read rather than repeated, so a hue changed in the registry cannot quietly drift out of step with
 * its own tour).
 *
 * Real dates, and the *same* ones CyclePageStep shows: both read from `demoCycle()`, so the run
 * that reads "26–30" on the plugin's own page lands on the 26th through the 30th here too, instead
 * of a second, disconnected fabrication that merely looks similar. The grid is however many weeks
 * that plus a following prediction actually need — grown to fit both rather than a fixed three
 * weeks, since real dates cannot be placed wherever is convenient the way an arbitrary day count
 * could.
 *
 * Real switcher, fixed to this plugin's tab for the same reason HabitsCalendarStep's is: there is
 * no fabricated entries heatmap behind "Entries" to switch to, so it is disabled rather than only
 * looking pressable.
 */
export function CalendarStep() {
  const { t, i18n } = useTranslation();
  const isDark = useIsDark();
  const weekStart = useWeekStart();
  const hue = findPlugin('period-tracker')?.hue;

  const { cycle, byDate } = useMemo(demoCycle, []);

  const { predictedStart, predictedEnd } = useMemo(() => {
    const nextStart = toDateKey(addDays(parseDateKey(todayKey()), 8));
    return {
      predictedStart: nextStart,
      predictedEnd: toDateKey(addDays(parseDateKey(nextStart), PREDICTED_DAYS - 1)),
    };
  }, []);

  // Weekday-aligned, like CalendarPage's own `cells` — leading blanks so the first real date lands
  // in its actual weekday column, trailing ones so the grid still ends on a full week. Just built
  // over this cycle's own span instead of one calendar month, since the two windows this step has
  // to show may straddle a month boundary CalendarPage never has to think about.
  const cells = useMemo(() => {
    const first = parseDateKey(cycle.start);
    const last = parseDateKey(predictedEnd);
    const leading = (getDay(first) - weekStart + 7) % 7;
    const result: (string | null)[] = Array(leading).fill(null);
    for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
      result.push(toDateKey(cursor));
    }
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [cycle.start, predictedEnd, weekStart]);

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    weekdayName((weekStart + i) % 7, i18n.language, 'EEEEEE'),
  );

  const levelFor = (dateKey: string): number | null => {
    const marked = byDate.get(dateKey);
    if (marked) return CALENDAR_LEVEL[marked.flow];
    if (dateKey >= predictedStart && dateKey <= predictedEnd) return PREDICTED_CALENDAR_LEVEL;
    return null;
  };

  return (
    <div className="flex flex-col gap-3">
      <Tabs value="period-tracker">
        <TabsList>
          <TabsTrigger value="entries" disabled className="gap-1.5">
            <BookOpen className="size-3.5" aria-hidden />
            {t('calendar.entries')}
          </TabsTrigger>
          <TabsTrigger value="period-tracker" className="gap-1.5">
            <Droplet className="size-3.5" aria-hidden />
            {t('plugins.period-tracker.name')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-xl border bg-card p-3 shadow-xs">
        <div className="grid grid-cols-7 gap-0.5 mb-1">
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
          {cells.map((dateKey, i) => {
            if (!dateKey) return <div key={i} className="h-10" />;
            const level = levelFor(dateKey);
            return (
              <div
                key={i}
                className="relative flex h-10 w-full items-center justify-center rounded-lg border border-transparent text-[13px] text-muted-foreground"
                style={
                  level === null
                    ? undefined
                    : { backgroundColor: pluginHeatmapBg(level, isDark, hue) }
                }
              >
                <span
                  className={cn(level !== null && level >= 1 && 'font-semibold text-foreground')}
                >
                  {Number(dateKey.slice(8))}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-center gap-2 border-t pt-3">
          <span className="text-[11px] text-muted-foreground">{t('common.less')}</span>
          <div className="flex gap-0.5">
            {[0, PREDICTED_CALENDAR_LEVEL, 0.32, CALENDAR_LEVEL.medium, CALENDAR_LEVEL.heavy].map(
              (op) => (
                <div
                  key={op}
                  className="size-3.5 rounded-sm border"
                  style={{
                    backgroundColor: op === 0 ? 'transparent' : pluginHeatmapBg(op, isDark, hue),
                    borderColor: 'var(--border)',
                  }}
                />
              ),
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">{t('common.more')}</span>
        </div>
      </div>
    </div>
  );
}
