import { addDays } from 'date-fns';
import { parseDateKey, toDateKey } from '@/lib/dates';

/** How far back the day widget reads, and the bound on every walk below. Long enough that a
    displayed streak is never truncated by the window rather than by a missed day — and if one ever
    is, it is capped honestly at 90. */
export const STREAK_WINDOW_DAYS = 90;

/**
 * How many days in a row a habit has been done, counting back from a given day.
 *
 * Pure, and kept out of the widget for the reason lib/notificationSchedule.ts was kept out of
 * lib/notifications.ts: date arithmetic is where the bugs are, and it can only be tested cheaply
 * while it has no dependencies to stand up.
 *
 * ## Why not subtract 86,400,000
 *
 * Because two days a year that is wrong. Stepping back through `addDays` on a *local* date — which
 * is what `parseDateKey` produces — lands on the previous calendar day across a DST boundary, where
 * subtracting 24 hours lands on 23:00 the same day or 01:00 the day before. On a spring-forward
 * date a millisecond walk would count one day twice and break the streak a day early.
 *
 * ## What counts as a day
 *
 * A **met** day, not a recorded one. Twelve of a hundred push-ups is progress worth recording and it
 * is not a day of the habit: a streak that ticks up on any nonzero number is a streak of having
 * opened the app. What "met" means per kind lives in `metTarget` — a goal reached, or, for the kinds
 * that have no goal to fall short of, simply recorded.
 *
 * ## What breaks a streak
 *
 * A missing day, with one exception: **today, not yet done, does not break it.** A streak shown on
 * the day page is read at every hour of the day, and telling someone at 09:00 that their 40-day run
 * has ended because they haven't done it *yet* is both false and the exact opposite of useful. So
 * the count starts from `from` if that day is met, and from the day before otherwise.
 *
 * That does mean a streak "survives" the whole of the day it will actually be broken on, which is
 * the right trade: it is corrected at midnight, and no one is misled about anything they can still
 * change.
 *
 * ## A day that was never asked about breaks nothing
 *
 * Once a habit can be scheduled, "a missing day" stops meaning "a day with nothing recorded". A
 * habit set for Mondays, Wednesdays and Fridays has nothing recorded on any Tuesday, and counting
 * those would cap every such streak at one — the number would measure the calendar rather than the
 * person. So `scheduledOn` says which days the habit was actually asked on, and the walk *skips*
 * the rest rather than treating them as either met or missed. A streak of a weekly habit is then
 * a run of weeks, which is what someone keeping it would call it.
 *
 * The default is "every day", so a habit that has never had a schedule counts exactly as it always
 * did.
 */
export function currentStreak(
  met: ReadonlySet<string>,
  from: string,
  scheduledOn?: (dateKey: string) => boolean,
): number {
  return streakBefore(met, from, scheduledOn) + (met.has(from) ? 1 : 0);
}

/**
 * The run of met days ending the day *before* `from` — a streak with today's own answer left out.
 *
 * This is the number the day page actually wants, and the reason is that it does not move. Today's
 * value is the only thing on that screen that can change, and it can only ever change the streak by
 * one: `streakBefore(…) + (met today ? 1 : 0)` *is* `currentStreak`. So the walk is done once, from
 * history that is settled and immutable, and the badge becomes a pure function of local state.
 *
 * Computing the whole streak instead meant recomputing it from a `history` map that a debounced
 * write and its sync reload rewrite a second later — so ticking a habit showed the new streak, then
 * the stored one, then the new one again. Nothing was wrong with the arithmetic; it was being asked
 * a question whose inputs were briefly stale. Excluding today removes the staleness from the input.
 */
export function streakBefore(
  met: ReadonlySet<string>,
  from: string,
  /** Which days this habit's question was actually put on. Days it says no to are stepped over —
      see "A day that was never asked about breaks nothing" above. */
  scheduledOn: (dateKey: string) => boolean = () => true,
  /** How far back to walk. Bounded rather than open-ended now that days can be skipped: a monthly
      habit's walk would otherwise run to the beginning of time looking for the next occurrence.
      The default is the window the callers read, so a streak is never longer than its evidence. */
  limit = STREAK_WINDOW_DAYS,
): number {
  let cursor = addDays(parseDateKey(from), -1);
  let streak = 0;
  for (let step = 0; step < limit; step++) {
    const day = toDateKey(cursor);
    if (scheduledOn(day)) {
      if (!met.has(day)) break;
      streak++;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * The date keys, oldest first, for a window of `days` ending at `from`.
 *
 * The widget's read window: streaks only need as far back as the streak runs, but a query has to
 * ask for something bounded. A quarter is far more than any streak the card displays and still a
 * trivial range scan.
 */
export function dateKeyWindow(from: string, days: number): string[] {
  const end = parseDateKey(from);
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset--) keys.push(toDateKey(addDays(end, -offset)));
  return keys;
}

/** Every date key from `start` to `end`, inclusive, oldest first. The calendar view's read range —
    a bounded span rather than a window counting back from today, since a month can be any month. */
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
