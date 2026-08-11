import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginCalendarDay, PluginCalendarViewProps } from '../types';
import { usePeriodCalendar } from './useCycle';

/**
 * The period tracker's calendar view: a day's shading is how sure this plugin is that a period
 * happened, or is about to. Confirmed days shade darker the heavier the flow logged; a predicted
 * day, inside the window `predictNext` guesses at but never marked, shades in the same reddish hue at
 * a fixed, lighter level — a guess reading visibly lighter than a fact, before the tooltip has to say
 * so in words.
 *
 * Headless, like every calendar view: `usePeriodCalendar` has already done the judging, this only
 * turns its numbers into the `{level, label}` shape the calendar page wants.
 */
export function PeriodCalendarView({ start, end, onData }: PluginCalendarViewProps) {
  const { t } = useTranslation();
  const days = usePeriodCalendar(start, end);

  useEffect(() => {
    const data = new Map<string, PluginCalendarDay>();
    for (const [day, info] of days) {
      const label = info.confirmed
        ? t('plugins.period-tracker.confirmedLabel', {
            flow: t(`plugins.period-tracker.flow${capitalize(info.flow ?? 'medium')}`),
          })
        : t('plugins.period-tracker.predictedLabel');
      data.set(day, { level: info.level, label });
    }
    onData(data);
  }, [days, onData, t]);

  return null;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
