import { addDays } from 'date-fns';
import { parseDateKey, toDateKey } from '@/lib/dates';
import { habitAppliesOn, habitOrigin, isTask, scheduleAt, type Habit } from './model';
import { occursOn } from './schedule';
import { STREAK_WINDOW_DAYS } from './streaks';

/**
 * A task that is still owed, and the day it was owed from.
 *
 * The whole of what makes a task different from a box you tick. Every other kind's question belongs
 * to its day and expires with it: nobody wants yesterday's push-ups added to today's. A task's
 * question does not — "renew the passport" is not answered by the day ending, it is answered by
 * renewing the passport — so it keeps being asked, and says how long it has been waiting.
 *
 * ## The rule, in one sentence
 *
 * **A task is owed on a day if its schedule fell on that day or an earlier one, and nothing has
 * been recorded since.**
 *
 * That is deliberately not a queue. Three missed occurrences of a weekly chore do not become three
 * things to tick — you do the washing up once, however many days you let it pile up — so one
 * completion clears everything outstanding behind it, and only the *oldest* unanswered occurrence
 * is named. A backlog that grows a row per missed week would turn a diary into a guilt ledger, and
 * would need its own storage to track which of three identical boxes was which.
 *
 * ## Why today's own tick is not consulted
 *
 * The walk stops at a completion *before* the day being asked about, never on the day itself. So
 * ticking an overdue task does not change the answer: the row keeps saying what it was overdue
 * from, right through the tick, the debounced write and the sync reload that follows it. Same
 * reason `streakBefore` excludes today — a badge that recomputes from a value the user is currently
 * changing is a badge that flickers.
 *
 * ## How far back it looks
 *
 * `STREAK_WINDOW_DAYS`, and not by coincidence: it is the window the day page and the widget
 * already read, so this asks nothing of the database that was not fetched anyway. A task ignored
 * for longer than a quarter stops nagging, which is a bound worth having in its own right — the
 * alternative is a chore entered eighteen months ago quietly marking every day since as a miss.
 */
export interface TaskState {
  /** The day the oldest unanswered occurrence fell on. */
  dueOn: string;
  /** Whether that day has already passed — `dueOn < dateKey`. False on the day it is due. */
  overdue: boolean;
}

/** How far back an unfinished task keeps being asked. Deliberately the day page's own read window;
    see the note above. */
export const TASK_CARRY_DAYS = STREAK_WINDOW_DAYS;

/**
 * The oldest occurrence of a task still owed on `dateKey`, or `undefined` if none is.
 *
 * `doneDays` is every day this task was actually recorded on — `values[habit.id] > 0` — which the
 * callers all have already, since a streak needs the same history. Passed rather than read here so
 * this stays a pure function of dates and a set, the same posture streaks.ts takes and for the same
 * reason: date arithmetic is where the bugs are, and it is only cheap to test while it has nothing
 * to stand up.
 *
 * Undefined for every kind but `task`, so callers can ask unconditionally rather than branching on
 * the kind at each of the four surfaces that need this.
 */
export function pendingTask(
  habit: Habit,
  dateKey: string,
  doneDays: ReadonlySet<string>,
  carry = TASK_CARRY_DAYS,
): TaskState | undefined {
  if (!isTask(habit)) return undefined;
  // Retired, or not yet created: an archived task must not go on asking, and a day before the task
  // existed is not a day it was owed on.
  if (!habitAppliesOn(habit, dateKey)) return undefined;

  const origin = habitOrigin(habit);
  let cursor = parseDateKey(dateKey);
  let due: string | undefined;

  for (let step = 0; step < carry; step++) {
    const day = toDateKey(cursor);
    if (origin && day < origin) break;
    /* A completion clears everything up to and including the day it was made on, so there is
       nothing older to find behind it. Strictly before `dateKey`: see the note above on why the
       day's own tick is not consulted. */
    if (day < dateKey && doneDays.has(day)) break;
    // Kept, not returned: the walk continues in case an *older* occurrence is still unanswered, and
    // that is the one worth naming.
    if (habitAppliesOn(habit, day) && occursOn(scheduleAt(habit, day), day, origin)) due = day;
    cursor = addDays(cursor, -1);
  }

  return due === undefined ? undefined : { dueOn: due, overdue: due < dateKey };
}

/** The days a habit was recorded on, out of the history the callers already hold. The one shape
    `pendingTask` needs, built the same way in each of the places that needs it. */
export function doneDaysOf(
  habitId: string,
  history: ReadonlyMap<string, Record<string, number>>,
): Set<string> {
  const days = new Set<string>();
  for (const [day, recorded] of history) {
    if ((recorded[habitId] ?? 0) > 0) days.add(day);
  }
  return days;
}
