import type { PluginRecordDto } from '@diary/shared';
import { z } from 'zod';

/**
 * What the habit tracker stores, and how it reads it back.
 *
 * The server never inspects a plugin's `data` — that is what makes adding a plugin a client-only
 * change — so the shape is enforced here, on read, and nowhere else. Same posture the backup
 * importer takes toward a file it did not write: parse, don't trust.
 *
 * ## Two row shapes, distinguished by dateKey
 *
 * A **definition** is an undated row (`dateKey: ''`), one per habit. One row each rather than a
 * single list, because that is what makes two devices independent: renaming a habit on the phone
 * and adding one on the laptop are then writes to different rows, which cannot collide.
 *
 * A **day** is a dated row, one per day, holding what was recorded — `{ values: { <habitId>: n } }`.
 * One row per day rather than one per (habit, day): five habits over five years is 9,000 rows the
 * second way and 1,800 the first, the conflict granularity matches what a person thinks of as one
 * edit ("what I did on Tuesday"), and a reset payload stays proportional to the diary.
 *
 * ## Why values are numbers, including for a checkbox
 *
 * A habit is either something you did or didn't (`check`) or something you did an amount of
 * (`count` — twenty push-ups, thirty minutes). Storing both as a number means one shape to read,
 * one shape to sum, and one meaning for "progress": greater than zero. A `check` simply stores 1.
 */

export const MAX_HABITS = 30;
export const MAX_HABIT_NAME_LENGTH = 60;
export const MAX_HABIT_UNIT_LENGTH = 16;
export const MAX_HABIT_TARGET = 100_000;

/**
 * The five things a habit can be.
 *
 * They differ only in how a day's number is *entered and read* — never in how it is stored. A
 * binary is 1, a scale is its position, a mood is 1–5, time is minutes. One stored shape means one
 * meaning for "progress" (greater than zero), one export column type, and a kind that can be added
 * later without touching the collection.
 *
 *   binary   did it happen — a box
 *   numeric  how many — push-ups, glasses of water
 *   time     how long — minutes, entered and shown as hours and minutes
 *   scale    how much, judged rather than counted — sleep quality, on a dragged track
 *   mood     how it felt — five faces
 */
export type HabitKind = 'binary' | 'numeric' | 'time' | 'scale' | 'mood';

export const HABIT_KINDS: readonly HabitKind[] = ['binary', 'numeric', 'time', 'scale', 'mood'];

/** Scale bounds, when a habit doesn't set its own. Mood is always exactly this. */
export const DEFAULT_SCALE_MIN = 1;
export const DEFAULT_SCALE_MAX = 5;
export const MOOD_LEVELS = 5;

/* The first build shipped `check` and `count` before the other three existed. Mapped on read rather
   than migrated: a Dexie upgrade would have to run over rows belonging to a plugin that may not
   even be installed, and this costs one lookup. Writes always use the new names. */
const LEGACY_KINDS: Record<string, HabitKind> = { check: 'binary', count: 'numeric' };

const kindSchema = z
  .string()
  .transform((value) => LEGACY_KINDS[value] ?? value)
  .pipe(z.enum(['binary', 'numeric', 'time', 'scale', 'mood']))
  // `.catch` rather than a hard failure: a row from a future build that adds a sixth kind should
  // read as a plain box here, not vanish from the list.
  .catch('binary');

const definitionSchema = z.object({
  kind: z.literal('habit'),
  name: z.string().trim().min(1).max(MAX_HABIT_NAME_LENGTH),
  type: kindSchema,
  /** Numeric only: "push-ups", "reps". Shown beside the number, never parsed. Time has its own
      formatting and mood and scale have no unit to speak of. */
  unit: z.string().trim().max(MAX_HABIT_UNIT_LENGTH).optional(),
  /** Numeric and time only: the daily goal the bar fills toward. Optional — plenty of things are
      worth recording without a number to fall short of. */
  target: z.number().int().min(1).max(MAX_HABIT_TARGET).optional(),
  /** Scale only. Mood is fixed at 1–5 and ignores these. */
  min: z.number().int().min(0).max(MAX_HABIT_TARGET).optional(),
  max: z.number().int().min(1).max(MAX_HABIT_TARGET).optional(),
  /** The day the *current* configuration took effect. Days before it are judged by `revisions`. */
  since: z.string().catch(''),
  /**
   * Superseded configurations, oldest first.
   *
   * The reason this exists is a bug you would never see reported, only felt: raise a goal from 50
   * push-ups to 100 and every day you hit 50 stops counting as met, retroactively. The grid rewrites
   * three weeks of history, and the diary now disagrees with what actually happened.
   *
   * So a goal is not a property of the habit, it is a property of the habit *on a day*. Each edit
   * banks the configuration it replaced along with the day it started applying, and everything that
   * judges a day — the grid, the progress bar, the export — asks `configAt` rather than reading the
   * current values. Editing becomes additive: nothing about the past changes when you change your
   * mind about the future.
   */
  revisions: z
    .array(
      z.object({
        since: z.string(),
        changedAt: z.string(),
        name: z.string(),
        unit: z.string().optional(),
        target: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    )
    .catch([]),
  order: z.number().int().min(0).max(MAX_HABITS).catch(0),
  /**
   * When this habit stopped being asked about.
   *
   * Archiving rather than deleting, once a habit has ever been recorded. The days it happened on
   * are part of the diary — as much a record of that week as the entries beside them — and a
   * feature that quietly erases months of history to tidy up a list is one that makes people
   * reluctant to tidy up. A habit with no progress at all has no history to protect and is simply
   * deleted.
   */
  archivedAt: z.string().nullable().catch(null),
});

/* Two shapes, because the first build stored `{ ticks: { id: true } }` before count habits existed.
   Read both, write only `values` — the same read-side heal `normalizeBirthday` uses, and the reason
   there is no Dexie upgrade for this: plugin rows are the plugin's business, and a migration would
   have to run on rows belonging to a plugin that may not even be installed. */
const daySchema = z.object({
  values: z.record(z.string(), z.number()).catch({}),
  ticks: z.record(z.string(), z.boolean()).catch({}),
});

/** The part of a habit that can be edited, and therefore the part that has a history. */
export interface HabitConfig {
  name: string;
  unit?: string;
  target?: number;
  min?: number;
  max?: number;
}

export interface HabitRevision extends HabitConfig {
  /** The day this configuration started applying. */
  since: string;
  /** When the edit that superseded it was made. */
  changedAt: string;
}

export interface Habit extends HabitConfig {
  /** The row id — the habit's identity everywhere else, including in a day's values. */
  id: string;
  /** The kind never changes: stored values mean different things per kind, and reinterpreting a
      year of numbers is not an edit, it is a different habit. */
  type: HabitKind;
  since: string;
  revisions: HabitRevision[];
  order: number;
  archivedAt: string | null;
}

/** A definition row, or undefined if this row is not one. */
export function parseHabit(record: PluginRecordDto): Habit | undefined {
  const parsed = definitionSchema.safeParse(record.data);
  if (!parsed.success) return undefined;
  const { name, type, unit, target, min, max, since, revisions, order, archivedAt } = parsed.data;
  return {
    id: record.id,
    name,
    type,
    unit,
    target,
    min,
    max,
    // '' for a row written before edits were tracked: it has no history, so its current
    // configuration has always applied. `configAt` treats that as "since forever".
    since,
    revisions,
    order,
    archivedAt,
  };
}

export const habitData = (habit: Omit<Habit, 'id'>) => ({
  kind: 'habit' as const,
  name: habit.name,
  type: habit.type,
  ...(habit.unit ? { unit: habit.unit } : {}),
  ...(habit.target ? { target: habit.target } : {}),
  ...(habit.min !== undefined ? { min: habit.min } : {}),
  ...(habit.max !== undefined ? { max: habit.max } : {}),
  since: habit.since,
  revisions: habit.revisions,
  order: habit.order,
  archivedAt: habit.archivedAt,
});

/**
 * The habit as it was configured on a given day.
 *
 * Everything that judges a day goes through here rather than reading the current values, which is
 * what stops an edit from rewriting the past. With no date, or no history, it is the habit itself.
 */
export function configAt(habit: Habit, dateKey?: string): HabitConfig {
  const current: HabitConfig = {
    name: habit.name,
    unit: habit.unit,
    target: habit.target,
    min: habit.min,
    max: habit.max,
  };
  if (!dateKey || !habit.revisions.length || (habit.since && dateKey >= habit.since))
    return current;
  // Newest first: the last configuration that had started by this day.
  for (let i = habit.revisions.length - 1; i >= 0; i--) {
    if (dateKey >= habit.revisions[i].since) return habit.revisions[i];
  }
  // Older than anything recorded — the earliest configuration is the closest true answer.
  return habit.revisions[0];
}

/** Whether two configurations differ in any way worth recording as an edit. */
export const configChanged = (a: HabitConfig, b: HabitConfig): boolean =>
  a.name !== b.name ||
  a.unit !== b.unit ||
  a.target !== b.target ||
  a.min !== b.min ||
  a.max !== b.max;

/** A scale's bounds, with mood's fixed values and the defaults already applied. */
export function scaleBounds(habit: Habit, dateKey?: string): { min: number; max: number } {
  if (habit.type === 'mood') return { min: 1, max: MOOD_LEVELS };
  const config = configAt(habit, dateKey);
  const min = config.min ?? DEFAULT_SCALE_MIN;
  const max = config.max ?? DEFAULT_SCALE_MAX;
  // Guard rather than trust: a hand-edited or future row must not produce an inverted track.
  return max > min ? { min, max } : { min: DEFAULT_SCALE_MIN, max: DEFAULT_SCALE_MAX };
}

/**
 * Time is stored in **seconds**, and displayed in whatever unit is worth reading.
 *
 * Seconds because the stopwatch produces them: pausing at 14 minutes 9 seconds and resuming later
 * has to resume from 14:09, not from a rounded 14:00 that quietly loses nine seconds every time.
 * The precision is kept in the data and spent only at the point of display.
 *
 * Whether the display shows them depends on the goal, because that is what makes a second
 * meaningful. Ten minutes of stretching is a thing you measure in seconds; two hours of study is
 * not, and "1h 59m 47s" is noise pretending to be precision.
 */
const SECONDS_SHOWN_BELOW_TARGET = 10 * 60;

export const showsSeconds = (habit: Habit, dateKey?: string): boolean => {
  const target = configAt(habit, dateKey).target;
  return habit.type === 'time' && target !== undefined && target < SECONDS_SHOWN_BELOW_TARGET;
};

export function formatDuration(totalSeconds: number, withSeconds: boolean): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  // Under a minute always shows seconds, goal or no goal: "0m" for 40 seconds of work reads as
  // nothing having been recorded at all.
  if (hours === 0 && minutes === 0) return `${rest}s`;
  if (hours === 0) return withSeconds ? `${minutes}m ${rest}s` : `${minutes}m`;
  return withSeconds ? `${hours}h ${minutes}m ${rest}s` : `${hours}h ${minutes}m`;
}

/**
 * What a recorded value reads as: "20 reps", "1h 20m", "4/5".
 *
 * One place, because the day card, the plugin page and the Markdown export must not disagree about
 * what a number means — and time is the one where they easily would.
 */
export function formatHabitValue(habit: Habit, value: number, dateKey?: string): string {
  if (habit.type === 'time') return formatDuration(value, showsSeconds(habit, dateKey));
  if (habit.type === 'scale' || habit.type === 'mood') {
    return `${value}/${scaleBounds(habit, dateKey).max}`;
  }
  const unit = configAt(habit, dateKey).unit;
  return unit ? `${value} ${unit}` : `${value}`;
}

/** Whether a day's value counts as reaching the habit's goal, for the filled/half-filled grid. */
export function metTarget(habit: Habit, value: number, dateKey?: string): boolean {
  if (value <= 0) return false;
  if (habit.type === 'scale' || habit.type === 'mood') return true; // recorded *is* the goal
  /* Against the goal that was in force *that day*, not today's. Raising a goal must not turn a
     wall of met days amber overnight — see the note on `revisions`. */
  const target = configAt(habit, dateKey).target;
  return target ? value >= target : true;
}

/**
 * Whether a habit had been created by a given day — regardless of whether it has since been
 * retired.
 *
 * Judged from the same trail an edit already leaves — the earliest banked revision if there is
 * one, `since` otherwise — so a habit's reach into the past is exactly as defensible as
 * `configAt`'s reading of it elsewhere. Kept separate from `habitAppliesOn`: "did this habit exist
 * yet" and "is this habit still being asked about" are different questions, with different
 * answers wanted for them — a day after a habit was retired should still say *something* about it
 * having existed, where a day before it was ever created should not.
 */
export function habitCreatedBy(habit: Habit, dateKey: string): boolean {
  const origin = habit.revisions[0]?.since || habit.since;
  return !origin || dateKey >= origin;
}

/**
 * Whether a habit should be judged on a given day at all — it existed, and had not yet been
 * retired, as of that day.
 *
 * For the calendar view, which scores a whole *day* rather than one habit: a day before a habit was
 * created, or after it was archived, is not a day it fell short on, it is a day the question wasn't
 * being asked, and counting it either way would water down every other day's ratio.
 */
export function habitAppliesOn(habit: Habit, dateKey: string): boolean {
  if (!habitCreatedBy(habit, dateKey)) return false;
  // A habit archived *on* dateKey was still live for most of it, so only days strictly after the
  // archive day are excluded — the day it happened on stays judged, like everywhere else in the plugin.
  if (habit.archivedAt && habit.archivedAt.slice(0, 10) < dateKey) return false;
  return true;
}

/** What was recorded on a day, per habit id. Absent means nothing; there is no stored zero. */
export function parseValues(record: PluginRecordDto | undefined): Record<string, number> {
  if (!record) return {};
  const parsed = daySchema.safeParse(record.data);
  if (!parsed.success) return {};
  const legacy = Object.fromEntries(
    Object.entries(parsed.data.ticks)
      .filter(([, done]) => done)
      .map(([id]) => [id, 1]),
  );
  // `values` wins where both exist: a row healed by this build has already been rewritten.
  return { ...legacy, ...parsed.data.values };
}

/**
 * A day row's payload.
 *
 * Zero is stored as absence, not as `0`. It keeps the row proportional to what actually happened,
 * it makes "did this habit happen" one question rather than two, and it means archiving or deleting
 * a habit leaves no residue on the days it was never done.
 */
export const valueData = (values: Record<string, number>) => ({
  values: Object.fromEntries(Object.entries(values).filter(([, value]) => value > 0)),
});

export const isDone = (values: Record<string, number>, habitId: string): boolean =>
  (values[habitId] ?? 0) > 0;

export const sortHabits = (habits: Habit[]): Habit[] =>
  [...habits].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

export const isArchived = (habit: Habit): boolean => habit.archivedAt !== null;
