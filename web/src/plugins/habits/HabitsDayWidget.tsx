import { CircleCheckBig, ListPlus, PowerOff, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { notifyError } from '@/lib/notify';
import { captureError } from '@/lib/telemetry';
import { cn } from '@/lib/utils';
import { setPluginEnabled } from '@/plugins/enabled';
import {
  HabitControl,
  HabitProgress,
  HiddenSection,
  STREAK_MIN,
  StreakBadge,
  useLiveHabitValue,
} from './HabitControls';
import { metTarget, type Habit } from './model';
import { useHabitsDay } from './useHabits';

/**
 * The habit checklist on the day page.
 *
 * Deliberately a checklist and not a workbench. It sits below the composer on a screen whose job is
 * writing the diary, so it has to be readable at a glance and finished with in two taps. Everything
 * that needs deciding rather than doing — creating a habit, naming it, choosing whether it counts
 * or ticks, retiring it — lives on the plugin's own page. Nothing here creates or destroys.
 */
export function HabitsDayWidget({ dateKey }: { dateKey: string }) {
  const { t } = useTranslation();
  const { active, archivedWithProgress, values, priorStreaks, loading, hasAnyHabit, setValue } =
    useHabitsDay(dateKey);

  /**
   * What the badge reads, for a habit, right now.
   *
   * The run ending yesterday is settled and was computed once; today can only add one to it, and
   * only if the goal was actually *reached* — twelve of a hundred push-ups is progress, not a day of
   * the habit. So this is arithmetic on local state with no read behind it, which is what makes the
   * number move the instant you tick, and stay put while the write and its sync reload go by.
   */
  const streakOf = (habit: Habit) =>
    (priorStreaks.get(habit.id) ?? 0) + (metTarget(habit, values[habit.id] ?? 0, dateKey) ? 1 : 0);

  /* Reserved for the whole list, not per row: without it the controls sit at a different x on every
     row depending on whether that habit happens to be on a run, and the column jitters as streaks
     start and break. Reserved only when at least one row will use it, so a list that never streaks
     doesn't carry an empty gutter. */
  const anyStreak = active.some((habit) => streakOf(habit) >= STREAK_MIN);

  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs" aria-labelledby="habits-day-title">
      <div className="flex items-center gap-2">
        <CircleCheckBig className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 id="habits-day-title" className="flex-1 text-sm font-medium">
          {t('plugins.habits.title')}
        </h2>
        {!loading && active.length > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {/* Goals reached, not habits touched — the same bar the streak is held to, and for the
                same reason: 12 of 100 push-ups counted here would make 5/5 mean "I opened the app
                five times". `metTarget` judges each against the goal in force on this day. */}
            {t('plugins.habits.doneOf', {
              done: active.filter((habit) => metTarget(habit, values[habit.id] ?? 0, dateKey))
                .length,
              total: active.length,
            })}
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-2/3" />
        </div>
      ) : !hasAnyHabit ? (
        <NoHabitsYet />
      ) : (
        <>
          {active.length > 0 && (
            /* A hairline between habits. The rows carry controls of very different heights — a row
               of faces beside a checkbox — and without a rule they read as one drifting block. */
            <ul className="mt-1 divide-y divide-border/60">
              {active.map((habit) => (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  value={values[habit.id] ?? 0}
                  dateKey={dateKey}
                  streak={streakOf(habit)}
                  reserveStreak={anyStreak}
                  onChange={(next) => setValue(habit.id, next)}
                />
              ))}
            </ul>
          )}

          {/* Every habit retired but this day has none of them recorded: not an empty state — the
              habits exist, they are simply all in the past. */}
          {active.length === 0 && archivedWithProgress.length === 0 && (
            <p className="mt-1 text-sm text-muted-foreground">{t('plugins.habits.allRetired')}</p>
          )}

          {/* Archived habits that *were* recorded on this day. Read-only: the day is a record, and
              an archived habit is not being asked about any more. In the same disclosure the diary
              uses for hidden sub-entries, because it is the same kind of thing — context. */}
          <HiddenSection
            count={archivedWithProgress.length}
            showLabel={t('plugins.habits.retiredOnDay', { count: archivedWithProgress.length })}
            hideLabel={t('plugins.habits.hideRetired')}
          >
            <ul className="divide-y divide-border/60">
              {archivedWithProgress.map((habit) => (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  value={values[habit.id] ?? 0}
                  dateKey={dateKey}
                  readOnly
                />
              ))}
            </ul>
          </HiddenSection>
        </>
      )}
    </section>
  );
}

function HabitRow({
  habit,
  value,
  dateKey,
  streak = 0,
  reserveStreak = false,
  onChange,
  readOnly = false,
}: {
  habit: Habit;
  value: number;
  dateKey: string;
  streak?: number;
  reserveStreak?: boolean;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const live = useLiveHabitValue(habit, value, dateKey);
  const done = live.total > 0;

  /**
   * Clearing a habit back to "not recorded", with an undo.
   *
   * Every kind gets the same affordance in the same place, rather than each control inventing its
   * own way back to nothing — tapping a box again, dragging a slider to its left end, stepping a
   * number down to zero. Those are three gestures for one idea, and for a slider the gesture is not
   * even available: parked at its minimum is a recorded 1, not an absence.
   */
  const clear = () => {
    const previous = value;
    onChange?.(0);
    toast(t('plugins.habits.cleared', { name: habit.name }), {
      action: { label: t('common.undo'), onClick: () => onChange?.(previous) },
    });
  };

  /* The one kind narrow enough to sit beside its name at every width: a single button, against the
     other four's stepper-and-bar or row of five faces, which on a phone leave no room for a name.
     So it keeps one row and puts the control at the end of it, where every other row's control also
     ends up — the eye runs down one column of things to press rather than two. */
  const inline = habit.type === 'binary';

  return (
    <li className="group flex items-center gap-2 py-2">
      <div
        className={cn(
          'flex min-w-0 flex-1 gap-x-2 gap-y-1',
          inline
            ? 'items-center'
            : 'flex-col items-stretch sm:flex-row sm:flex-wrap sm:items-center',
        )}
      >
        <span
          className={cn(
            'min-w-0 truncate text-sm transition-colors',
            inline ? 'flex-1' : 'sm:flex-1',
            done ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {habit.name}
        </span>

        {inline ? (
          <HabitControl
            habit={habit}
            live={live}
            dateKey={dateKey}
            onChange={onChange}
            readOnly={readOnly}
          />
        ) : (
          /* Wraps rather than squeezes. A stopwatch is three buttons and a duration, and on a narrow
             screen it and the bar simply do not share a line — so the bar drops to a row of its own
             (and takes the whole width of it) instead of both being compressed into illegibility.
             `sm:flex-nowrap` retires that concession the moment there is room: on a wide screen the
             controls and the bar they fill belong beside each other, not stacked. */
          <div
            className={cn(
              'flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:flex-nowrap',
              /* Given the room on a wide screen, these take it. A stepper and a 40-unit bar in the
                 corner of a full-width card looked like an afterthought bolted to the name. */
              habit.type === 'scale' ? 'sm:flex-[2]' : 'sm:flex-1 sm:justify-end',
            )}
          >
            <HabitControl
              habit={habit}
              live={live}
              dateKey={dateKey}
              onChange={onChange}
              readOnly={readOnly}
            />
            <HabitProgress habit={habit} live={live} dateKey={dateKey} />
          </div>
        )}
      </div>

      {/* The right rail: fixed width, pinned to the edge and centred against however tall the rest
          of the row has become. It is the same two slots on every row, so the eye can run down it. */}
      <div className="flex shrink-0 items-center gap-0.5 self-center">
        {reserveStreak && (
          <span className="flex w-10 justify-end">
            <StreakBadge streak={streak} />
          </span>
        )}
        {!readOnly && done ? (
          <Button
            variant="ghost"
            size="icon"
            /* Hidden until hover on a pointer device, always reachable by keyboard. On touch there
               is no hover, so it stays visible there. */
            className="size-7 opacity-100 transition-opacity sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
            aria-label={t('plugins.habits.clear', { name: habit.name })}
            onClick={clear}
          >
            <X className="size-3.5" />
          </Button>
        ) : (
          <span className="size-7" aria-hidden />
        )}
      </div>
    </li>
  );
}

/**
 * What the card says before any habit exists.
 *
 * Two ways out, because there are exactly two honest answers to "you have no habits": set some up,
 * or you didn't want this. The second is offered as plainly as the first — a plugin that is only
 * easy to turn on is one people resent.
 */
function NoHabitsYet() {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  const disable = async () => {
    setWorking(true);
    try {
      await setPluginEnabled('habits', false);
    } catch (err) {
      captureError(err, { scope: 'habits.disable' });
      notifyError(t('settings.plugins.saveFailed'));
      setWorking(false);
      setConfirming(false);
    }
  };

  return (
    <div className="mt-2">
      <p className="text-sm text-muted-foreground">{t('plugins.habits.empty')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm" className="gap-1.5">
          <Link to="/plugins/habits">
            <ListPlus className="size-3.5" />
            {t('plugins.habits.setUp')}
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => setConfirming(true)}
        >
          <PowerOff className="size-3.5" />
          {t('plugins.habits.turnOff')}
        </Button>
      </div>

      {/* Confirmed, because it is one tap from a screen the user opened to write a diary entry, and
          because enabling a plugin syncs — so does turning it off, on every device. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('plugins.habits.turnOffTitle')}</DialogTitle>
            <DialogDescription>{t('plugins.habits.turnOffDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={working}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void disable()} disabled={working}>
              {t('plugins.habits.turnOff')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
