import { UNDATED_KEY, type PluginRecordDto } from '@diary/shared';
import { db } from '@/db/db';
import i18n from '@/i18n';
import { habitChanges } from './changes';
import { formatHabitValue, parseHabit, parseValues } from './model';

/**
 * The habit log, as a Markdown table: one row per day, one column per habit.
 *
 * A table rather than a list per habit, because the interesting question a log answers is what a
 * *day* looked like — which is also how it lines up with the diary entries this gets appended to.
 *
 * Only days that were recorded appear. Filling in the gaps would make the document longer and say
 * something the data does not: a missing row means nothing was written, not that nothing was done.
 */
export async function exportHabitsMarkdown(): Promise<{ filename: string; markdown: string }[]> {
  const rows = await db.pluginRecords.where('pluginId').equals('habits').toArray();

  /* Retired habits are included. The export is a record of what happened, and a month where a
     habit was still being tracked does not stop having happened because it was retired later. */
  const habits = rows
    .filter((row) => row.scope === 'record' && row.dateKey === UNDATED_KEY)
    .flatMap((row) => parseHabit(row) ?? [])
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  if (!habits.length) return [];

  const days = rows
    .filter((row) => row.scope === 'record' && row.dateKey !== UNDATED_KEY)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  if (!days.length) return [];

  const escape = (text: string) => text.replace(/\|/g, '\\|');
  const header = `| ${i18n.t('plugins.habits.dateColumn')} | ${habits.map((h) => escape(h.name)).join(' | ')} |`;
  const divider = `| --- | ${habits.map(() => '---').join(' | ')} |`;
  const body = days.map((day: PluginRecordDto) => {
    const recorded = parseValues(day);
    /* A count shows its number; a checkbox shows a mark, not "yes"/"no" — the column is scanned
       down, not read across, and a word in every cell turns a table into a wall. */
    const cells = habits.map((habit) => {
      const value = recorded[habit.id] ?? 0;
      if (value <= 0) return '';
      // A binary is a mark, not "yes" — the column is scanned down, not read across, and a word in
      // every cell turns a table into a wall. Everything else prints what it actually was.
      // Formatted against the configuration in force on that day, for the same reason the grid is.
      return habit.type === 'binary' ? '×' : formatHabitValue(habit, value, day.dateKey);
    });
    return `| ${day.dateKey} | ${cells.join(' | ')} |`;
  });

  return [
    {
      filename: 'habits.md',
      markdown: [`## ${i18n.t('plugins.habits.title')}`, '', header, divider, ...body].join('\n'),
    },
  ];
}
