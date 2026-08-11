import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginCalendarDay, PluginCalendarViewProps } from '../types';
import { useHabitsCalendar } from './useHabits';

/**
 * The habit tracker's calendar view: a day's shading becomes "how many of that day's habits were
 * met", in place of the diary's own entry heatmap.
 *
 * Headless, like every calendar view — the page owns the cell itself (today's ring, the tap
 * target, the birthday marker) and only wants numbers to colour it with. `useHabitsCalendar` has
 * already judged each day against `habitAppliesOn` and `metTarget`, the same two functions the day
 * widget and the streak grid use, so a habit that didn't exist yet, was later retired, or had its
 * goal raised mid-month reads on the calendar exactly as it reads everywhere else in the plugin.
 *
 * The `t()` call is the reason this file exists separately from `useHabitsCalendar`: that hook stays
 * free of strings, same split the day widget and the library hook keep between data and display.
 */
export function HabitsCalendarView({ start, end, onData }: PluginCalendarViewProps) {
  const { t } = useTranslation();
  const ratios = useHabitsCalendar(start, end);

  useEffect(() => {
    const data = new Map<string, PluginCalendarDay>();
    for (const [day, { met, total }] of ratios) {
      // Same shape the day card's own counter uses (`t('plugins.habits.doneOf')`) — a ratio read on
      // the calendar should look like the ratio read on the day it came from.
      data.set(day, {
        level: met / total,
        label: t('plugins.habits.doneOf', { done: met, total }),
      });
    }
    onData(data);
  }, [ratios, onData, t]);

  return null;
}
