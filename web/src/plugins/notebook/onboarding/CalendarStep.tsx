import { BookOpen, NotebookPen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { weekdayName } from '@/lib/dates';
import { useWeekStart } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { PLUGIN_HEATMAP_RGB, pluginHeatmapBg, useIsDark } from '@/pages/CalendarPage';
import { findPlugin } from '@/plugins/registry';
import { levelFor } from '../NotebookCalendarView';

/**
 * Three weeks of net characters gained per day, shaded exactly as the Calendar page's Notebook tab
 * shades them.
 *
 * Deliberately the same shape as habits' own CalendarStep — the switcher is the app's real `Tabs`,
 * the grid carries weekday headings and day numbers, and the legend is the same less-to-more ramp —
 * because that *is* what the calendar looks like, and a simplified sketch of it would be teaching a
 * screen the app doesn't have.
 *
 * Two things are read rather than repeated, so neither can drift out of step with the real view:
 * the hue comes from this plugin's own manifest entry, and the levels come from `levelFor`, the same
 * bucketing NotebookCalendarView reports. Change either and this tour changes with it.
 */

/** Net characters gained on each of three weeks' days — a believable stretch, not a tidy one: two
    quiet weekends, one evening that ran long, and a few days with nothing at all. */
const DEMO_CHARACTERS = [
  0, 310, 0, 1240, 90, 0, 0, 640, 0, 220, 2100, 0, 0, 150, 0, 0, 480, 830, 0, 1900, 0,
];

export function CalendarStep() {
  const { t, i18n } = useTranslation();
  const isDark = useIsDark();
  const weekStart = useWeekStart();
  const hue = findPlugin('notebook')?.hue ?? PLUGIN_HEATMAP_RGB;

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    weekdayName((weekStart + i) % 7, i18n.language, 'EEEEEE'),
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Real switcher, fixed to this plugin's tab: there is no fabricated entries heatmap behind
          "Entries" to switch to, so it is disabled rather than only looking pressable. */}
      <Tabs value="notebook">
        <TabsList>
          <TabsTrigger value="entries" disabled className="gap-1.5">
            <BookOpen className="size-3.5" aria-hidden />
            {t('calendar.entries')}
          </TabsTrigger>
          <TabsTrigger value="notebook" className="gap-1.5">
            <NotebookPen className="size-3.5" aria-hidden />
            {t('plugins.notebook.name')}
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
          {DEMO_CHARACTERS.map((characters, i) => (
            // Plain divs, not buttons: the real cells navigate to a day, and none of these
            // fabricated days exist to navigate to.
            <div
              key={i}
              className="relative flex h-10 w-full items-center justify-center rounded-lg border border-transparent text-[13px] text-muted-foreground"
              style={
                characters > 0
                  ? { backgroundColor: pluginHeatmapBg(levelFor(characters), isDark, hue) }
                  : undefined
              }
            >
              <span className={cn(characters >= 1500 && 'font-semibold text-foreground')}>
                {i + 1}
              </span>
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
                    op === 0 ? 'transparent' : `rgba(${isDark ? hue.dark : hue.light}, ${op})`,
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
