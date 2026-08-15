import { CircleCheckBig } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HabitRow } from '../HabitsDayWidget';
import { metTarget } from '../model';
import { anyDemoStreak, buildDemoExamples, demoDateKey, demoStreak } from './demoExamples';

/**
 * All five kinds a habit can be, each shown through `HabitRow` — the exact row HabitsDayWidget
 * renders on the day page, not a redrawing of it. That match has to be literal, not just visual:
 * `HabitRow` switches shape at a `@[480px]:` container-query breakpoint, and a hand-copied version
 * of it is exactly the kind of thing that quietly drifts the next time the real one changes. So
 * this wraps the same `@container` PluginDaySlot puts around every day widget, and otherwise gets
 * completely out of `HabitRow`'s way.
 *
 * Fixed, read-only values rather than something to play with: two of the five (the streak badges
 * on Meditate and Push-ups) are already doing the one piece of teaching that needed a value to
 * differ from "recorded" or "not" — a run that continues in amber, and one about to break in grey —
 * and a control a visitor could actually drag or tick invites trying every one of them for its own
 * sake, which is a different tour than "here is what tracking looks like".
 */
export function TypesStep() {
  const { t } = useTranslation();
  const dateKey = demoDateKey();
  const examples = useMemo(() => buildDemoExamples(t), [t]);

  // Same two numbers HabitsDayWidget's own header shows: how many of today's habits are met, and
  // whether any row's streak needs the badge column reserved for the rest to line up against.
  const met = examples.filter(({ habit, value }) => metTarget(habit, value, dateKey)).length;
  const reserveStreak = anyDemoStreak(examples, dateKey);

  return (
    <div className="space-y-4 @container">
      <section
        className="rounded-xl border bg-card p-4 shadow-xs"
        aria-labelledby="onboarding-habits-types"
      >
        <div className="flex items-center gap-2">
          <CircleCheckBig className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h2 id="onboarding-habits-types" className="flex-1 text-sm font-medium">
            {t('plugins.habits.title')}
          </h2>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {t('plugins.habits.doneOf', { done: met, total: examples.length })}
          </span>
        </div>
        <ul className="mt-1 divide-y divide-border/60">
          {examples.map((example) => (
            <HabitRow
              key={example.habit.id}
              habit={example.habit}
              value={example.value}
              dateKey={dateKey}
              streak={demoStreak(example, dateKey)}
              reserveStreak={reserveStreak}
              readOnly
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
