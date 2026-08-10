import type { TFunction } from 'i18next';
import { formatDuration, showsSeconds, type Habit, type HabitConfig } from './model';

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

export function habitChanges(habit: Habit, t: TFunction): HabitChange[] {
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
