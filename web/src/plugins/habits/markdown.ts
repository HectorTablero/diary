import { addDays } from 'date-fns';
import { UNDATED_KEY, type PluginRecordDto } from '@diary/shared';
import { db } from '@/db/db';
import i18n from '@/i18n';
import { parseDateKey, toDateKey, todayKey } from '@/lib/dates';
import { inExportRange } from '@/plugins/markdown';
import type { PluginExportRange } from '@/plugins/types';
import { describeSchedule, habitChanges, habitSummary } from './changes';
import {
  formatHabitValue,
  habitAppliesOn,
  habitOccursOn,
  habitOrigin,
  isCheckbox,
  isTask,
  parseHabit,
  parseValues,
  scheduleAt,
  type Habit,
} from './model';
import { doneDaysOf, pendingTask } from './tasks';

/**
 * The habit log, as a Markdown table: one row per day, one column per habit — preceded by what
 * each habit *was* over the stretch of time it was actually being kept.
 *
 * A table rather than a list per habit, because the interesting question a log answers is what a
 * *day* looked like — which is also how it lines up with the diary entries this gets appended to.
 *
 * Only days that were recorded appear. Filling in the gaps would make the document longer and say
 * something the data does not: a missing row means nothing was written, not that nothing was done.
 *
 * ## Why an empty cell is not one thing
 *
 * A grid of habits against dates is rectangular; a diary is not. A habit created in March has no
 * February, a retired one has no September, and one asked about on Mondays has no Tuesdays — none
 * of which is the same silence as a day it *was* asked about and nothing was recorded. Left as a
 * blank cell they all read alike, and the reader this export is written for (see
 * MarkdownExportDialog) has no card to check it against: it would read a seasonal habit's whole
 * off-season as months of failure, and a habit's first year as a run of missed days stretching
 * back to whenever the diary itself began.
 *
 * So every cell says which of those it is, and every habit carries the period it was being tracked
 * over, the schedule it was asked on, and the edits that period contains. All of it judged through
 * `habitOccursOn` and `pendingTask` — the same functions the day page and the grid ask — so the
 * document cannot disagree with the app it came out of.
 *
 * ## What a date range does to all of that
 *
 * An export of March gets March's rows, and the counts above them are counted over March. The
 * alternative — a clipped table under a habit's lifetime totals — reads as a run of missing days:
 * "asked about on 264 days · 190 days recorded" over a table holding 31 rows invites exactly one
 * conclusion, and it is the wrong one. So the counting window is the tracked period intersected
 * with the range, and the "tracked from" line says outright that it has been clipped, because a
 * count of 31 with no such note is indistinguishable from a habit that only existed for a month.
 *
 * Two things are deliberately *not* clipped. `doneDays` is computed over the whole log, because an
 * unfinished task carries forward and whether it is still pending on 3 March depends on whether it
 * was ever completed — including in April. And a habit's origin and edit history stay absolute:
 * they say when the thing being tabulated came to be, which is context the clipped table cannot
 * supply and the reader has no other way to get.
 */

/** A ticked box. A count, a duration or a rating prints what it actually was instead. */
const DONE = '×';
/** Asked about on that day, and nothing recorded. */
const MISSED = '·';
/** Being kept, but its schedule does not fall on that day. */
const UNSCHEDULED = '–';
/** Not being tracked then at all — before it existed, or after it was retired. */
const UNTRACKED = '';

/** Every date from `from` to `to` inclusive, and none at all when the range is inverted — which is
    what a habit created after the last recorded day gives. */
function dateRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let cursor = parseDateKey(from); ; cursor = addDays(cursor, 1)) {
    const day = toDateKey(cursor);
    if (day > to) return days;
    days.push(day);
  }
}

/**
 * Whether this habit's question was put to a given day.
 *
 * `habitOccursOn` is the whole answer for five of the six kinds. A task is the exception, by
 * design: an unfinished one keeps being asked on the days after the one it was due on, and those
 * are days its schedule says nothing about — so a blank there is a miss, not an off-day, and only
 * `pendingTask` knows the difference.
 */
const asked = (habit: Habit, dateKey: string, doneDays: ReadonlySet<string>): boolean =>
  habitOccursOn(habit, dateKey) ||
  (isTask(habit) && pendingTask(habit, dateKey, doneDays) !== undefined);

export async function exportHabitsMarkdown(
  range: PluginExportRange,
): Promise<{ filename: string; markdown: string }[]> {
  const rows = await db.pluginRecords.where('pluginId').equals('habits').toArray();

  /* Retired habits are included. The export is a record of what happened, and a month where a
     habit was still being tracked does not stop having happened because it was retired later. */
  const allHabits = rows
    .filter((row) => row.scope === 'record' && row.dateKey === UNDATED_KEY)
    .flatMap((row) => parseHabit(row) ?? [])
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  if (!allHabits.length) return [];

  const allDays = rows
    .filter((row) => row.scope === 'record' && row.dateKey !== UNDATED_KEY)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  if (!allDays.length) return [];

  /* Over the whole log, not the range: an unfinished task keeps being asked about on the days after
     it was due, so whether it was still pending on a day inside the range depends on whether it was
     ever done — which may well have been after the range ends. Clipping this would turn a task
     finished in April into one still outstanding through all of March. */
  const history = new Map(allDays.map((day) => [day.dateKey, parseValues(day)] as const));
  const doneDays = new Map(allHabits.map((habit) => [habit.id, doneDaysOf(habit.id, history)]));

  const days = allDays.filter((day) => inExportRange(day.dateKey, range));
  if (!days.length) return [];

  const lng = i18n.language;
  const escape = (text: string) => text.replace(/\|/g, '\\|');

  /* How far forward "still being tracked" reaches. Today, normally — but a day page can be
     unlocked and written on ahead of time, and a horizon behind the log would report a habit as
     never having been asked on a day it was plainly recorded on. Taken from the whole log rather
     than the clipped one: it bounds the habit's life, which a date picker does not shorten. */
  const lastLogged = allDays[allDays.length - 1].dateKey;
  const horizon = todayKey() > lastLogged ? todayKey() : lastLogged;

  /* The clipped counting window, as a note for the "tracked from" line. Only one end may be set, so
     there are three ways of saying it and no way to build them by concatenation — `from` and `to`
     land in different places in different languages. */
  const clipNote = !range.from
    ? range.to
      ? i18n.t('plugins.habits.exportClippedTo', { to: range.to })
      : null
    : range.to
      ? i18n.t('plugins.habits.exportClippedRange', { from: range.from, to: range.to })
      : i18n.t('plugins.habits.exportClippedFrom', { from: range.from });

  const legend = [
    `### ${i18n.t('plugins.habits.exportHowToRead')}`,
    '',
    `- \`${DONE}\` — ${i18n.t('plugins.habits.exportKeyDone')}`,
    `- \`${MISSED}\` — ${i18n.t('plugins.habits.exportKeyMissed')}`,
    `- \`${UNSCHEDULED}\` — ${i18n.t('plugins.habits.exportKeyUnscheduled')}`,
    `- ${i18n.t('plugins.habits.exportKeyUntracked')}`,
    `- ${i18n.t('plugins.habits.exportKeyTask')}`,
    `- ${i18n.t('plugins.habits.exportOnlyRecordedDays')}`,
    '',
  ];

  /* Each habit with the window its counts are taken over: the period it was tracked for, clipped to
     the export's range. A habit whose whole life falls outside the range is dropped along with its
     column — it has nothing to say about these days, and an all-blank column under a name is a
     question the reader has to go and answer somewhere else. */
  const tracked = allHabits.flatMap((habit) => {
    /* From the day it came into existence — the same anchor `occursOn` counts an interval from —
       to the day it was retired, or to the horizon while it is still being kept. A row written
       before edits were tracked has no origin at all, and the log's own first day is the earliest
       thing that can honestly be claimed for it. */
    const origin = habitOrigin(habit) || allDays[0].dateKey;
    const retiredOn = habit.archivedAt?.slice(0, 10) ?? null;
    const from = range.from && range.from > origin ? range.from : origin;
    const to = range.to && range.to < horizon ? range.to : horizon;
    /* Counted by asking `habitOccursOn` day by day rather than from the shape of the schedule, so a
       habit that spent March on weekdays and April on Mondays is counted as each of them in turn,
       and so the count stops of its own accord on the day the habit was retired — which is also
       what keeps a habit retired before the range began out of the table below. */
    const occurrences = dateRange(from, to).filter((day) => habitOccursOn(habit, day)).length;
    const recorded = [...(doneDays.get(habit.id) ?? [])].filter((day) =>
      inExportRange(day, range),
    ).length;
    if (!occurrences && !recorded) return [];
    return [{ habit, origin, retiredOn, occurrences, recorded }];
  });
  if (!tracked.length) return [];

  const habits = tracked.map(({ habit }) => habit);

  const descriptions = tracked.flatMap(({ habit, origin, retiredOn, occurrences, recorded }) => {
    const changes = habitChanges(habit, i18n.t, lng);

    return [
      `### ${escape(habit.name)}`,
      '',
      `- ${habitSummary(habit, i18n.t)}`,
      `- ${describeSchedule(scheduleAt(habit), i18n.t, lng)}`,
      /* The tracked period is the habit's own, absolute — it says when the thing being tabulated
         came to be, which the clipped table cannot. The note after it is what stops the counts on
         the next line reading as a lifetime: without it, "asked about on 31 days" under a habit
         kept for two years is a plain falsehood rather than a figure with a stated scope. */
      `- ${
        retiredOn
          ? i18n.t('plugins.habits.exportTrackedClosed', { from: origin, to: retiredOn })
          : i18n.t('plugins.habits.exportTrackedOpen', { from: origin })
      }${clipNote ? ` (${clipNote})` : ''}`,
      `- ${i18n.t('plugins.habits.exportAskedDays', { count: occurrences })} · ${i18n.t(
        'plugins.habits.recordedDays',
        { count: recorded },
      )}`,
      ...(changes.length
        ? [
            `- ${i18n.t('plugins.habits.changesHeading')}:`,
            ...changes.flatMap((change) =>
              change.lines.map((line) => `  - ${escape(`${change.since} — ${line}`)}`),
            ),
          ]
        : []),
      '',
    ];
  });

  const header = `| ${i18n.t('plugins.habits.dateColumn')} | ${habits.map((h) => escape(h.name)).join(' | ')} |`;
  const divider = `| --- | ${habits.map(() => '---').join(' | ')} |`;
  const body = days.map((day: PluginRecordDto) => {
    const recorded = history.get(day.dateKey) ?? {};
    const cells = habits.map((habit) => {
      const value = recorded[habit.id] ?? 0;
      // A ticked box is a mark, not "yes" — the column is scanned down, not read across, and a
      // word in every cell turns a table into a wall. A task is a box too, and a late one is
      // recorded on the day it was actually done, so the row it lands on is the truthful one.
      // Everything else prints what it actually was, formatted against the configuration in force
      // on that day, for the same reason the grid is.
      if (value > 0) {
        return isCheckbox(habit.type) ? DONE : escape(formatHabitValue(habit, value, day.dateKey));
      }
      /* Nothing recorded, so which of the three silences this is decides what the cell says. Out
         of the tracked period first: a habit that did not exist yet cannot have been asked. */
      if (!habitAppliesOn(habit, day.dateKey)) return UNTRACKED;
      return asked(habit, day.dateKey, doneDays.get(habit.id) ?? new Set()) ? MISSED : UNSCHEDULED;
    });
    return `| ${day.dateKey} | ${cells.join(' | ')} |`;
  });

  return [
    {
      filename: 'habits.md',
      markdown: [
        `## ${i18n.t('plugins.habits.title')}`,
        '',
        ...legend,
        ...descriptions,
        `### ${i18n.t('plugins.habits.exportLogHeading')}`,
        '',
        header,
        divider,
        ...body,
      ].join('\n'),
    },
  ];
}
