import { differenceInCalendarDays, getDate, getDay, getDaysInMonth } from 'date-fns';
import { z } from 'zod';
import { parseDateKey } from '@/lib/dates';

/**
 * When a habit is asked about at all.
 *
 * ## Why this is a separate axis from the kind
 *
 * A habit's `type` says how a day's number is *entered and read*; this says *which days ask the
 * question*. They are genuinely independent — a mood rated every Sunday and a box ticked on the 1st
 * of the month are both sensible — so folding one into the other would mean a kind per combination,
 * and a control that has to be reimplemented for each.
 *
 * Keeping it separate also means every existing habit already has a schedule: `daily`, which is
 * what a stored row with no `schedule` field reads as. Nothing had to be migrated, and nothing about
 * a diary written before this existed changes.
 *
 * ## Why it lives in the config, and therefore in the revisions
 *
 * A schedule is exactly the kind of thing `revisions` was built for. Move a habit from every day to
 * weekdays only and, judged by today's schedule, every Saturday you ever missed would stop counting
 * as a miss — the grid, the streak and the calendar would all rewrite themselves backwards. So a
 * schedule is a property of the habit *on a day*, read through `configAt` like a goal or a name, and
 * an edit only ever applies from the day it was made. See the note on `revisions` in model.ts.
 *
 * ## The five shapes
 *
 *   daily      every day — what every habit was before this existed
 *   once       one day only, the day the habit was created. Only a task uses it: a habit that
 *              happens once is a task, and a task that repeats has one of the four below.
 *   weekdays   chosen days of the week — 0 is Sunday, matching `getDay` and `weekdayName`
 *   monthly    the same date each month, clamped to the last day of the shorter ones
 *   interval   every N days, counted from the habit's origin
 */

/** Longest interval worth offering. A year of "every N days" is a `monthly` in disguise, and the
    bound is what stops a hand-edited row producing an occurrence that never comes round. */
export const MAX_INTERVAL_DAYS = 365;

/** Shortest. One would be `daily` spelled the long way, and two schedules that mean the same thing
    is one more state for everything downstream to distinguish for no gain. */
export const MIN_INTERVAL_DAYS = 2;

export type HabitSchedule =
  | { kind: 'daily' }
  | { kind: 'once' }
  /** Day indices, 0 = Sunday. Deduplicated and sorted on read, so two rows meaning the same week
      compare equal in `sameSchedule` regardless of the order they were clicked in. */
  | { kind: 'weekdays'; days: number[] }
  | { kind: 'monthly'; day: number }
  | { kind: 'interval'; every: number };

export type HabitScheduleKind = HabitSchedule['kind'];

export const SCHEDULE_KINDS: readonly HabitScheduleKind[] = [
  'daily',
  'weekdays',
  'monthly',
  'interval',
];

/** Days of the week, Sunday first — the order `getDay` numbers them in. The picker rotates this to
    the user's own week start; the storage never does, so a row means the same thing everywhere. */
export const WEEKDAY_INDICES: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * Parsed, or `undefined` for a row that has none — which is not the same as `daily`.
 *
 * A missing schedule means "whatever this kind does by default", and that differs: a habit is daily,
 * a task happens once. Resolving it here would have to know the kind, which this module deliberately
 * does not; `scheduleAt` in model.ts is where the two meet.
 *
 * Malformed reads as missing rather than failing, the same posture `kindSchema` takes: a schedule
 * shape from a future build should leave the habit working, not remove it from the list.
 */
export const scheduleSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('daily') }),
    z.object({ kind: z.literal('once') }),
    z.object({
      kind: z.literal('weekdays'),
      days: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .max(7)
        .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    }),
    z.object({ kind: z.literal('monthly'), day: z.number().int().min(1).max(31) }),
    z.object({
      kind: z.literal('interval'),
      every: z.number().int().min(MIN_INTERVAL_DAYS).max(MAX_INTERVAL_DAYS),
    }),
  ])
  .optional()
  .catch(undefined);

/**
 * Whether a schedule asks its question on a given day.
 *
 * `origin` is the day the habit came into existence — `habitOrigin` in model.ts, the same trail
 * `habitCreatedBy` reads. Two of the five shapes need it, and both need it to be *stable*: an
 * anchor that moved every time the habit was renamed would shift an "every 3 days" habit onto a
 * different set of days retroactively, which is the exact failure `revisions` exists to prevent.
 * An empty origin — a row written before edits were tracked — falls back to "every day", because
 * an unanchored interval has no honest answer and a habit that vanishes is worse than one that
 * asks too often.
 */
export function occursOn(schedule: HabitSchedule, dateKey: string, origin: string): boolean {
  switch (schedule.kind) {
    case 'daily':
      return true;
    case 'once':
      return !origin || dateKey === origin;
    case 'weekdays':
      return schedule.days.includes(getDay(parseDateKey(dateKey)));
    case 'monthly': {
      const date = parseDateKey(dateKey);
      /* The 31st in a month that has 30 days lands on the 30th rather than being skipped: a monthly
         task set for the last day of the month is the commonest reason to pick 31, and silently
         missing February would make it wrong eleven times a year. */
      return getDate(date) === Math.min(schedule.day, getDaysInMonth(date));
    }
    case 'interval': {
      if (!origin) return true;
      const delta = differenceInCalendarDays(parseDateKey(dateKey), parseDateKey(origin));
      return delta >= 0 && delta % schedule.every === 0;
    }
  }
}

/** Whether two schedules would ask the same question on every day — what `configChanged` needs to
    decide an edit is worth banking a revision for. */
export function sameSchedule(a: HabitSchedule | undefined, b: HabitSchedule | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'weekdays' && b.kind === 'weekdays') {
    return a.days.length === b.days.length && a.days.every((day, i) => day === b.days[i]);
  }
  if (a.kind === 'monthly' && b.kind === 'monthly') return a.day === b.day;
  if (a.kind === 'interval' && b.kind === 'interval') return a.every === b.every;
  return true;
}
