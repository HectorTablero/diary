import type { TFunction } from 'i18next';
import { localeWeekStart, weekdayName, type WeekStart } from '@/lib/dates';
import {
  defaultSchedule,
  formatDuration,
  scaleBounds,
  showsSeconds,
  type Habit,
  type HabitConfig,
} from './model';
import { sameSchedule, type HabitSchedule } from './schedule';

/**
 * A schedule, in words.
 *
 * Here rather than in schedule.ts for the split the whole plugin keeps: that file decides which
 * days a habit falls on and knows nothing about `t()`, this one turns a habit's configuration into
 * something a person reads. Both the card's summary line and the change log go through it, so the
 * page cannot describe a schedule one way and its own history another.
 *
 * Every branch is a string-literal key, for the reason `habitSummary` spells its branches out:
 * `checkI18n` can only see literals, and a key assembled at runtime is the first thing to go
 * missing in a translation nobody checks.
 */
export function describeSchedule(
  schedule: HabitSchedule,
  t: TFunction,
  lng: string,
  /** The first day of the reader's week — the Settings preference, already resolved. Defaults to
      what the language itself does, which is what `weekStartsOn: 'auto'` resolves to anyway. */
  weekStart: WeekStart = localeWeekStart(lng),
): string {
  switch (schedule.kind) {
    case 'once':
      return t('plugins.habits.scheduleOnce');
    case 'weekdays': {
      /* Listed from the reader's own first day, not from the stored Sunday-first order: someone
         whose week starts on Monday expects "Mon, Wed, Fri", and the storage is not what anyone is
         reading. The same preference the calendar's month grid is built from, so one setting
         decides where a week starts everywhere it is shown. */
      const ordered = [...schedule.days].sort(
        (a, b) => ((a - weekStart + 7) % 7) - ((b - weekStart + 7) % 7),
      );
      return t('plugins.habits.scheduleWeekdaysSummary', {
        days: ordered.map((day) => weekdayName(day, lng, 'EEE')).join(', '),
      });
    }
    case 'monthly':
      return t('plugins.habits.scheduleMonthlySummary', { day: schedule.day });
    case 'interval':
      return t('plugins.habits.scheduleIntervalSummary', { count: schedule.every });
    default:
      return t('plugins.habits.scheduleDaily');
  }
}

/**
 * The one-line description of what a habit *is*: its kind, and the unit, goal or bounds that give
 * its numbers meaning.
 *
 * Beside `describeSchedule` for the same reason — the card, the change log and the Markdown export
 * all have to say the same thing about a habit, and the export is read by an agent that has no card
 * to compare it against.
 *
 * Every branch is written out rather than built from a template, because `checkI18n` can only see
 * string-literal keys — a key assembled at runtime is invisible to it and would be the first thing
 * to go missing in a translation nobody checks.
 */
export function habitSummary(habit: Habit, t: TFunction): string {
  switch (habit.type) {
    case 'numeric':
      return habit.target
        ? t('plugins.habits.summaryNumeric_target', {
            unit: habit.unit || t('plugins.habits.typeNumeric'),
            target: habit.target,
          })
        : t('plugins.habits.summaryNumeric', {
            unit: habit.unit || t('plugins.habits.typeNumeric'),
          });
    case 'time':
      return habit.target
        ? t('plugins.habits.summaryTime_target', {
            target: formatDuration(habit.target, showsSeconds(habit)),
          })
        : t('plugins.habits.summaryTime');
    case 'scale': {
      const { min, max } = scaleBounds(habit);
      return t('plugins.habits.summaryScale', { min, max });
    }
    case 'mood':
      return t('plugins.habits.summaryMood');
    case 'task':
      return t('plugins.habits.summaryTask');
    default:
      return t('plugins.habits.summaryBinary');
  }
}

/**
 * A habit's edit history, oldest first, as lines a person can read.
 *
 * Shared by the card and the Markdown export so the diary tells one story about itself. Each entry
 * is a *transition* — what changed, and from which day the new value applied — because that is the
 * question the history exists to answer: "was I meeting the goal at the time?"
 */
export interface HabitChange {
  /** The day the new configuration started applying. */
  since: string;
  /** One line per field that actually changed. */
  lines: string[];
}

const goal = (habit: Habit, config: HabitConfig, t: TFunction): string =>
  config.target === undefined
    ? t('plugins.habits.noGoal')
    : habit.type === 'time'
      ? formatDuration(config.target, showsSeconds(habit))
      : `${config.target}${config.unit ? ` ${config.unit}` : ''}`;

export function habitChanges(
  habit: Habit,
  t: TFunction,
  lng = 'en',
  weekStart: WeekStart = localeWeekStart(lng),
): HabitChange[] {
  /* The configurations in order, current last. Each pair of neighbours is one edit. */
  const timeline: (HabitConfig & { since: string })[] = [
    ...habit.revisions,
    {
      since: habit.since,
      name: habit.name,
      unit: habit.unit,
      target: habit.target,
      min: habit.min,
      max: habit.max,
      schedule: habit.schedule,
    },
  ];

  const changes: HabitChange[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const before = timeline[i - 1];
    const after = timeline[i];
    const lines: string[] = [];

    if (before.name !== after.name) {
      lines.push(t('plugins.habits.changeName', { from: before.name, to: after.name }));
    }
    if (before.target !== after.target) {
      lines.push(
        t('plugins.habits.changeGoal', {
          from: goal(habit, before, t),
          to: goal(habit, after, t),
        }),
      );
    }
    if (before.unit !== after.unit && before.target === after.target) {
      // Only when it isn't already implied by the goal line above, which prints the unit with it.
      lines.push(
        t('plugins.habits.changeUnit', { from: before.unit ?? '—', to: after.unit ?? '—' }),
      );
    }
    if (!sameSchedule(before.schedule, after.schedule)) {
      /* The kind's own default stands in for a configuration banked before schedules existed, so
         the log reads "Every day → Weekdays" rather than "— → Weekdays" for the first one ever
         made: the habit really was daily, it just had no field saying so. */
      const fallback = defaultSchedule(habit.type);
      lines.push(
        t('plugins.habits.changeSchedule', {
          from: describeSchedule(before.schedule ?? fallback, t, lng, weekStart),
          to: describeSchedule(after.schedule ?? fallback, t, lng, weekStart),
        }),
      );
    }
    if (before.min !== after.min || before.max !== after.max) {
      lines.push(
        t('plugins.habits.changeScale', {
          from: `${before.min ?? 1}–${before.max ?? 5}`,
          to: `${after.min ?? 1}–${after.max ?? 5}`,
        }),
      );
    }

    if (lines.length) changes.push({ since: after.since, lines });
  }
  return changes;
}
