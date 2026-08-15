import type { TFunction } from 'i18next';
import { todayKey } from '@/lib/dates';
import { STREAK_MIN } from '../HabitControls';
import { metTarget, type Habit } from '../model';
import { demoHabit } from './demoHabit';

export interface DemoExample {
  habit: Habit;
  value: number;
  /** The run coming into today, before today's own value is judged against the goal — the same
      split HabitsDayWidget's own `streakOf` makes, so a habit that meets its goal here shows
      exactly the badge-colour change ticking it for real would produce. Fixed rather than derived
      from anything, since there is no history behind a habit that was never actually recorded. */
  priorStreak: number;
}

/**
 * The tour's one cast of habits — all five kinds, used by both TypesStep (the day-page controls)
 * and WidgetStep (the same habits, on the home-screen widget). One list rather than two, so the
 * tour reads as one diary followed across two surfaces instead of a fresh example on every screen.
 */
export function buildDemoExamples(t: TFunction): DemoExample[] {
  return [
    {
      habit: demoHabit({
        id: 'onboarding-demo-meditate',
        name: t('plugins.habits.onboarding.types.exampleMeditate'),
        type: 'binary',
      }),
      value: 1, // ticked for today
      priorStreak: 4, // + today met = 5, shown in amber
    },
    {
      habit: demoHabit({
        id: 'onboarding-demo-pushups',
        name: t('plugins.habits.onboarding.types.examplePushups'),
        type: 'numeric',
        unit: t('plugins.habits.onboarding.types.exampleReps'),
        target: 50,
      }),
      value: 20, // short of the goal
      priorStreak: 3, // today not met, so this stays 3 and shows grey
    },
    {
      habit: demoHabit({
        id: 'onboarding-demo-read',
        name: t('plugins.habits.onboarding.types.exampleRead'),
        type: 'time',
        target: 20 * 60,
      }),
      value: 12 * 60,
      priorStreak: 0,
    },
    {
      habit: demoHabit({
        id: 'onboarding-demo-sleep',
        name: t('plugins.habits.onboarding.types.exampleSleep'),
        type: 'scale',
        min: 1,
        max: 5,
      }),
      value: 4,
      priorStreak: 3,
    },
    {
      habit: demoHabit({
        id: 'onboarding-demo-mood',
        name: t('plugins.habits.onboarding.types.exampleMood'),
        type: 'mood',
      }),
      value: 4,
      priorStreak: 4,
    },
  ];
}

/** Today's run for one example, exactly HabitsDayWidget's own `streakOf`: the streak coming into
    today, plus one more if today's fixed value actually meets the goal. */
export const demoStreak = (example: DemoExample, dateKey: string): number =>
  example.priorStreak + (metTarget(example.habit, example.value, dateKey) ? 1 : 0);

/** The day key every example is judged against — one call, shared, so two steps rendered a moment
    apart can never disagree about what "today" was. */
export const demoDateKey = (): string => todayKey();

/** Whether any example's streak needs the badge column reserved for the rest to line up against —
    HabitsDayWidget's own `anyStreak`. */
export const anyDemoStreak = (examples: DemoExample[], dateKey: string): boolean =>
  examples.some((example) => demoStreak(example, dateKey) >= STREAK_MIN);
