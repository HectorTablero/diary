import { addDays, differenceInCalendarDays } from 'date-fns';
import { parseDateKey, toDateKey } from '@/lib/dates';

/**
 * Turning a set of marked days into cycles, and cycles into a guess at the next one.
 *
 * Pure and free of `t()`, kept apart from the hooks and components for the same reason
 * habits/streaks.ts is: date arithmetic is where the bugs hide, and it is only cheap to test while it
 * has no Dexie or React to stand up first.
 */

/** Population averages, used only for the parts a thin history can't yet answer for itself — see
    `predictNext`. Ordinary figures for cycle length and period duration, not this account's. */
export const DEFAULT_CYCLE_LENGTH_DAYS = 28;
export const DEFAULT_PERIOD_LENGTH_DAYS = 5;

/** How many of the most recent cycles the average is taken over. Recent, because a cycle length from
    a year ago says less about next month than one from last season — and bounded, so one very old,
    very long cycle can't sit in the average forever. */
const RECENT_CYCLES = 6;

/** How many days out the day page starts counting down to a predicted start. */
export const WARNING_WINDOW_DAYS = 5;

/** How long after a predicted window ends the day page keeps saying a period may still be coming,
    before it falls quiet. A period does not stop being possible the instant the average says it
    should have started — but nagging forever about an estimate that has clearly missed is worse than
    saying nothing. */
export const OVERDUE_GRACE_DAYS = 7;

export interface Cycle {
  /** dateKey of the first marked day. */
  start: string;
  /** dateKey of the last *consecutively* marked day — the run's own end, not necessarily settled if
      the run reaches all the way to today and might still be added to. */
  end: string;
}

/**
 * Marked days, grouped into cycles: maximal runs of consecutive dateKeys.
 *
 * `days` need not be sorted or deduplicated. A cycle is never stored — see the note in model.ts — so
 * this is what stands in for one, computed fresh from whatever day rows are on hand.
 */
export function groupCycles(days: Iterable<string>): Cycle[] {
  const sorted = [...new Set(days)].sort();
  const cycles: Cycle[] = [];
  for (const day of sorted) {
    const current = cycles[cycles.length - 1];
    if (current && toDateKey(addDays(parseDateKey(current.end), 1)) === day) {
      current.end = day;
    } else {
      cycles.push({ start: day, end: day });
    }
  }
  return cycles;
}

const average = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** A cycle's length in days, inclusive of both ends — the number a person means by "my period lasted
    five days". */
const cycleDuration = (cycle: Cycle): number =>
  differenceInCalendarDays(parseDateKey(cycle.end), parseDateKey(cycle.start)) + 1;

export interface RecentStats {
  /** Mean gap between the starts of the most recent cycles, in days. */
  avgCycleLength: number;
  /** Mean length of the most recent cycles, in days. */
  avgDuration: number;
  /** How many cycles the averages above were actually drawn from — at most `RECENT_CYCLES`, and the
      history page's cue for whether a number is worth showing at all. */
  sampleSize: number;
}

/**
 * The real averages behind a prediction — also what the plugin's own page shows as "how has this
 * been going", so a number shown there and the one silently driving the next guess are always the
 * same number.
 *
 * `undefined` below two cycles: a single cycle has a start but no *gap* to measure a length from, so
 * there is nothing here yet that isn't just restating the one cycle logged.
 */
export function recentStats(cycles: readonly Cycle[]): RecentStats | undefined {
  if (cycles.length < 2) return undefined;
  const recent = cycles.slice(-RECENT_CYCLES);
  const avgCycleLength = average(
    recent
      .slice(1)
      .map((cycle, i) =>
        differenceInCalendarDays(parseDateKey(cycle.start), parseDateKey(recent[i].start)),
      ),
  );
  const avgDuration = average(recent.map(cycleDuration));
  return { avgCycleLength, avgDuration, sampleSize: recent.length };
}

export interface Prediction {
  /** dateKey of the predicted next period's first day. */
  start: string;
  /** dateKey of its predicted last day. */
  end: string;
}

/**
 * A guess at the next period's window, from the cycles logged so far.
 *
 * - **No cycles at all**: nothing to count forward *from*, so this returns `undefined` rather than
 *   inventing an anchor. There is no such thing as a first guess with zero data points.
 * - **Exactly one cycle**: there is a real start to count forward from, but `recentStats` has nothing
 *   to say yet, so both the length and the duration fall back to the population averages above. A
 *   first estimate, openly not a personal one, rather than silence until a second cycle happens to
 *   get logged.
 * - **Two or more**: both come from `recentStats` — the mean of up to the last `RECENT_CYCLES` real
 *   cycles.
 */
export function predictNext(cycles: readonly Cycle[]): Prediction | undefined {
  if (cycles.length === 0) return undefined;

  const last = cycles[cycles.length - 1];
  const stats = recentStats(cycles);
  const cycleLength = stats?.avgCycleLength ?? DEFAULT_CYCLE_LENGTH_DAYS;
  const duration = stats?.avgDuration ?? DEFAULT_PERIOD_LENGTH_DAYS;

  const start = toDateKey(addDays(parseDateKey(last.start), Math.round(cycleLength)));
  const end = toDateKey(addDays(parseDateKey(start), Math.round(duration) - 1));
  return { start, end };
}

/** What the day page should say about a day that has not been marked, given a prediction (or the
    lack of one). Kept as a plain tag rather than a string here, for the same reason the calendar
    view's ratio type is: the words belong in the component, next to `t()`. */
export type PeriodOutlook =
  | { kind: 'none' }
  /** Approaching a predicted start, close enough to be worth mentioning — "in ~N days". */
  | { kind: 'approaching'; daysUntil: number }
  /** On or after the predicted start, through a grace period past its predicted end — deliberately
      not a day count: a prediction is a guess at a window, not at which day within it, and saying
      "day 2 of ~5" states a precision this plugin does not have. */
  | { kind: 'due' };

/**
 * The outlook for one day (today or a day still to come — see the note on why a past day never asks
 * this in PeriodDayWidget), given the current prediction.
 */
export function outlookFor(dateKey: string, prediction: Prediction | undefined): PeriodOutlook {
  if (!prediction) return { kind: 'none' };
  const { start, end } = prediction;

  if (dateKey < start) {
    const daysUntil = differenceInCalendarDays(parseDateKey(start), parseDateKey(dateKey));
    return daysUntil <= WARNING_WINDOW_DAYS ? { kind: 'approaching', daysUntil } : { kind: 'none' };
  }

  const graceEnd = toDateKey(addDays(parseDateKey(end), OVERDUE_GRACE_DAYS));
  return dateKey <= graceEnd ? { kind: 'due' } : { kind: 'none' };
}

/** Every date key from `start` to `end`, inclusive, oldest first. Its own copy rather than a shared
    import from habits/streaks.ts: plugins do not reach into one another, and this is four lines. */
export function dateKeysBetween(start: string, end: string): string[] {
  const keys: string[] = [];
  let cursor = parseDateKey(start);
  const last = parseDateKey(end);
  while (cursor <= last) {
    keys.push(toDateKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}
