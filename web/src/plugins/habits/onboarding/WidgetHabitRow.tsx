import { Angry, Check, Flame, Frown, Laugh, Meh, Minus, Play, Plus, Smile } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { HabitControl, HabitProgress, STREAK_MIN, type LiveValue } from '../HabitControls';
import { formatHabitValue, metTarget, type Habit } from '../model';

/**
 * One habit, laid out the way the Android home-screen widget's own row XML lays it out —
 * `widget_habits_row.xml` / `widget_habits_row_mood_inline.xml` — rather than `HabitRow`'s, which
 * is built for a day-page *card* wide enough to stack a control under a name. A widget tile never
 * has that room: name, streak and control share one line always, with the streak given a fixed
 * slot so every row's control lines up under the one above it whether or not that particular habit
 * is on a run.
 *
 * `HabitControl` and `HabitProgress` are reused for the one kind a hand-rolled version would be
 * worse than the real thing (the scale's drag track) and for the goal bar; everything else here —
 * the pill, the stepper, the faces — is a purpose-built, smaller sibling of those, on purpose: this
 * is a launcher tile, not a card, and its buttons read as smaller than this app's own tap-target
 * ones even once they are a comfortable size to look at rather than the smallest they could be.
 * `text-sm` throughout — name, value, the scale's own "4/5" reading included — is what keeps a
 * row's several pieces of text reading as one row instead of several typefaces that happen to
 * share a line.
 */
export function WidgetHabitRow({
  habit,
  value,
  streak,
  dateKey,
}: {
  habit: Habit;
  value: number;
  streak: number;
  dateKey: string;
}) {
  const { t } = useTranslation();
  const done = value > 0;
  const completed = metTarget(habit, value, dateKey);
  const hasGoal = (habit.type === 'numeric' || habit.type === 'time') && habit.target;

  return (
    <li className="flex flex-col gap-1 py-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'min-w-0 truncate text-sm',
            // The slider is the one control that needs the room a flexible name would take from
            // it, so its name is capped well short of half the row instead — same trade the
            // native layout makes by putting the stepper, not the label, on `layout_weight`.
            habit.type === 'scale' ? 'max-w-14 shrink-0' : 'flex-1',
            done ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {habit.name}
        </span>

        {/* Reserved whether or not *this* row is on a run, so a habit without one still lines its
            control up under the row above it — the gap the day page's own `reserveStreak` closes
            only when at least one habit qualifies, which a five-habit widget cannot rely on.

            Amber only while today is also met: the same distinction `StreakBadge` draws between a
            run that continues and one about to break, which Push-ups is here to demonstrate — a
            streak badge that stayed amber regardless would erase the one thing this row is meant
            to show. */}
        <span className="flex w-9 shrink-0 items-center justify-end">
          {streak >= STREAK_MIN && (
            <span
              className={cn(
                'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                completed
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <Flame className="size-2.5" aria-hidden />
              {streak}
            </span>
          )}
        </span>

        {habit.type === 'mood' && (
          <div
            className="flex shrink-0 items-center gap-0.5"
            role="radiogroup"
            aria-label={habit.name}
          >
            {[Angry, Frown, Meh, Smile, Laugh].map((Icon, index) => {
              const level = index + 1;
              const chosen = value === level;
              return (
                <span
                  key={level}
                  role="radio"
                  aria-checked={chosen}
                  aria-label={t(`plugins.habits.mood${level}`)}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full',
                    chosen ? 'bg-primary/15 text-primary' : 'text-muted-foreground/40',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </span>
              );
            })}
          </div>
        )}

        {/* Given the room the name's cap frees up: the drag track is the point of this row, not
            the label beside it. `[&>div]:gap-1` reaches into ScaleControl's own root — its
            `gap-3` is sized for the day page's much wider row, and left alone here it reads as a
            second empty column between the track and its "4/5" rather than the pair breathing.

            `[&_button]:!w-auto` undoes the other thing that width was measured for: EditableValue
            sets an inline `style={{ width }}` sized to the *longest* string this box could ever
            show (`VALUE_MIN_CHARS`, five characters minimum), specifically so the button and the
            field it turns into never resize each other. An inline style beats a class, which is
            why this needs `!important` rather than a plain override — but a fixed five-character
            floor is a day-page affordance this read-only row has no field to protect against, so
            here it can just be as wide as "4/5" actually is.

            `[&_button]:!font-normal` matches its weight to the rest of this row: ScaleControl
            bolds a recorded reading (`font-medium`) to stand out against a `text-muted-foreground`
            *un*recorded one, a contrast this row has no second state to draw against — every
            example here is always recorded, so the bold only read as the one piece of text on the
            row in a different weight from its neighbours. `mr-1` keeps the reading off the card's
            own edge, which the track's own trailing padding no longer reaches now that the gap
            beside it has shrunk. */}
        {habit.type === 'scale' && (
          <div className="min-w-24 flex-1 [&>div]:gap-1 [&_button]:!w-auto [&_button]:!font-normal [&_button]:mr-1">
            <HabitControl habit={habit} live={staticLive(value)} dateKey={dateKey} readOnly />
          </div>
        )}

        {habit.type === 'binary' && (
          <span
            role="checkbox"
            aria-checked={completed}
            aria-label={habit.name}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
              completed
                ? 'bg-primary text-primary-foreground'
                : 'border border-input text-muted-foreground',
            )}
          >
            <Check className={cn('size-3', !completed && 'opacity-30')} aria-hidden />
            {t('plugins.habits.markDone')}
          </span>
        )}

        {(habit.type === 'numeric' || habit.type === 'time') && (
          <div className="flex shrink-0 items-center gap-0.5">
            {/* Time only: the native row's stepper leads with play/pause, ahead of −/+ — this mock
                never runs, so it always reads as stopped, the same rest state every other button
                here is drawn in. */}
            {habit.type === 'time' && (
              <span
                aria-hidden
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground"
              >
                <Play className="size-3.5" />
              </span>
            )}
            <span
              aria-hidden
              className="flex size-6 items-center justify-center rounded-full text-muted-foreground"
            >
              <Minus className="size-3.5" />
            </span>
            <span className="min-w-9 px-0.5 text-center text-sm tabular-nums">
              {formatHabitValue(habit, value, dateKey)}
            </span>
            <span
              aria-hidden
              className="flex size-6 items-center justify-center rounded-full text-muted-foreground"
            >
              <Plus className="size-3.5" />
            </span>
          </div>
        )}
      </div>

      {hasGoal && <HabitProgress habit={habit} live={staticLive(value)} dateKey={dateKey} />}
    </li>
  );
}

/** A `LiveValue` for a control that never runs a timer: this row is `readOnly`, so `HabitControl`
    only ever reads `committed`/`total` off it, and `stopwatch` exists purely to satisfy the type
    without pulling in `useLiveHabitValue` (and the localStorage read that comes with it) for five
    habits that can never start one. */
const staticLive = (value: number): LiveValue => ({
  committed: value,
  pending: 0,
  total: value,
  stopwatch: { running: false, elapsed: 0, start: () => {}, stop: () => 0 },
});
