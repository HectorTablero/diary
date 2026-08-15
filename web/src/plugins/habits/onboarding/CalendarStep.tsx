import { BookOpen, CircleCheckBig } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { weekdayName } from '@/lib/dates';
import { useWeekStart } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { PLUGIN_HEATMAP_RGB, pluginHeatmapBg, useIsDark } from '@/pages/CalendarPage';

/**
 * A fabricated three weeks of "how many of that day's habits were met" (0 to 1), shaded with the
 * real formula the Calendar page shades its own plugin tabs with — `pluginHeatmapBg`, imported
 * rather than approximated, so this reads as *the* calendar view rather than a lookalike of it.
 * Three weeks, the same span HabitsPage's own recent-days strip uses: wide enough that the shading
 * reads as a pattern rather than a handful of isolated squares, narrow enough to need no scrolling.
 */
const DEMO_LEVELS = [
  1, 0.5, 0, 1, 0.75, 0, 1, 1, 0.25, 0.5, 1, 0, 0.75, 1, 1, 0.5, 0, 1, 0.25, 1, 0.75,
];

/**
 * A preview of the habit tracker's calendar view — CalendarPage.tsx's plugin tab, not a redrawing
 * of it: the tab switcher is the app's own `Tabs`, and the grid is shaded with the app's own
 * `pluginHeatmapBg`.
 *
 * The switcher is real but not functional: "Entries" is disabled and "Habits" is pinned as the
 * `value`, because there is no fabricated entries heatmap behind it to switch to — a tab that
 * looked pressable but did nothing on release would read as broken rather than as a preview. The
 * grid's cells are plain `<div>`s for the same reason: the real ones are buttons that navigate to
 * a day, and none of these fabricated days exist to navigate to.
 */
export function CalendarStep() {
  const { t, i18n } = useTranslation();
  const isDark = useIsDark();
  const weekStart = useWeekStart();

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    weekdayName((weekStart + i) % 7, i18n.language, 'EEEEEE'),
  );

  return (
    <div className="flex flex-col gap-3">
      <Tabs value="habits">
        <TabsList>
          <TabsTrigger value="entries" disabled className="gap-1.5">
            <BookOpen className="size-3.5" aria-hidden />
            {t('calendar.entries')}
          </TabsTrigger>
          <TabsTrigger value="habits" className="gap-1.5">
            <CircleCheckBig className="size-3.5" aria-hidden />
            {t('plugins.habits.name')}
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
          {DEMO_LEVELS.map((level, i) => (
            <div
              key={i}
              className="relative flex h-10 w-full items-center justify-center rounded-lg border border-transparent text-[13px] text-muted-foreground"
              style={{ backgroundColor: pluginHeatmapBg(level, isDark, PLUGIN_HEATMAP_RGB) }}
            >
              <span className={cn(level >= 1 && 'font-semibold text-foreground')}>{i + 1}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-center gap-2 border-t pt-3">
          <span className="text-[11px] text-muted-foreground">{t('common.less')}</span>
          <div className="flex gap-0.5">
            {[0, 0.08, 0.18, 0.32, 0.5].map((op) => (
              <div
                key={op}
                className="size-3.5 rounded-sm border"
                style={{
                  backgroundColor:
                    op === 0
                      ? 'transparent'
                      : `rgba(${isDark ? PLUGIN_HEATMAP_RGB.dark : PLUGIN_HEATMAP_RGB.light}, ${op})`,
                  borderColor: 'var(--border)',
                }}
              />
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">{t('common.more')}</span>
        </div>
      </div>
    </div>
  );
}
