import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginCalendarDay, PluginCalendarViewProps } from '../types';
import { useNotebookCalendar } from './useNotebook';

/**
 * The notebook's calendar view: how much the notebook *grew*, per day.
 *
 * Shaded by net characters gained — what a day added less what it cut, floored at zero per document
 * (see `useNotebookCalendar`). Both figures are already on each revision row, so painting a month is
 * a sum over an indexed range and never a replay of any patch chain.
 *
 * A day spent cutting a thought in half is real work and shows here as nothing. That is deliberate
 * and it is the same bargain a contribution graph makes: the cell answers "how much is there now
 * that wasn't before", which is a different question from the one the day card answers, and the
 * reason this grid reads as a contribution graph at a glance.
 *
 * Headless, like every calendar view: the page owns the cell and the colour, this only reports the
 * `{level, label}` pair per day.
 */
export function NotebookCalendarView({ start, end, onData }: PluginCalendarViewProps) {
  const { t } = useTranslation();
  const added = useNotebookCalendar(start, end);

  useEffect(() => {
    const data = new Map<string, PluginCalendarDay>();
    for (const [dateKey, characters] of added) {
      if (characters <= 0) continue;
      data.set(dateKey, {
        level: levelFor(characters),
        label: t('plugins.notebook.charactersAdded', { count: characters }),
      });
    }
    onData(data);
  }, [added, onData, t]);

  return null;
}

/**
 * Net characters gained, as a 0..1 shade.
 *
 * Fixed buckets rather than a scale relative to the month on screen. A relative scale would make the
 * same day look different depending on which month you happened to be looking at — and worse, would
 * make a quiet month look busy, since its own maximum would always paint at full strength. Fixed
 * thresholds mean the colour means the same thing everywhere, which is the only reason to look at a
 * heatmap of a year rather than at a list.
 *
 * The steps are a paragraph, a page, and several pages: the distinctions that exist in the writing
 * rather than in the arithmetic.
 */
export function levelFor(characters: number): number {
  if (characters >= 1500) return 1;
  if (characters >= 600) return 0.75;
  if (characters >= 200) return 0.5;
  return 0.25;
}
