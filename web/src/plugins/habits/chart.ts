import { addDays, differenceInCalendarDays } from 'date-fns';
import { parseDateKey, toDateKey, type WeekStart } from '@/lib/dates';
import {
  configAt,
  habitOccursOn,
  habitOrigin,
  isCheckbox,
  isTask,
  metTarget,
  scaleBounds,
  type Habit,
} from './model';
import { TASK_CARRY_DAYS } from './tasks';

/**
 * The data behind a habit's lifetime chart. Kept free of React and `t()`, like the rest of the
 * plugin's arithmetic, so the part where the bugs live can be tested on plain numbers.
 *
 * Every day is judged as it was configured *that day* — `configAt`, `metTarget`, `scaleBounds` —
 * so the chart tells the same story as the grid: raising a goal moves the goal line from that day
 * on, and leaves every earlier bar exactly as tall and as met as it was.
 */

export interface ChartDay {
  key: string;
  /** Weekday (0 = Sunday) and day of the month — kept so grouping never re-parses a date. */
  weekday: number;
  monthDay: number;
  value: number;
  /** Asked that day, or answered anyway — the calendar's rule, so the two never disagree. */
  asked: boolean;
  met: boolean;
  /** Numeric and time only, as configured that day. */
  target?: number;
  /** Scale and mood only: the scale's bounds that day. */
  min?: number;
  max?: number;
  /** Tasks only: the day this one was still owed from, when that was an earlier day and nothing
      was recorded on this one. Not counted as asked, for the calendar's reason — the day it was
      due on already says it was missed, once. */
  overdueFrom?: string;
}

/** Every day from the habit's first to its last, oldest first. */
export function habitLifetime(
  habit: Habit,
  history: ReadonlyMap<string, Record<string, number>>,
  today: string,
): ChartDay[] {
  const recorded = [...history]
    .filter(([, values]) => (values[habit.id] ?? 0) > 0)
    .map(([key]) => key)
    .sort();
  /* A row from before edits were tracked has no origin, and a value can predate one (an import):
     the earlier of the two, so nothing that was recorded falls off the left edge. */
  const origin = habitOrigin(habit);
  const first = [origin, recorded[0]].filter(Boolean).sort()[0] ?? today;
  const retired = habit.archivedAt?.slice(0, 10);
  const last = [retired && retired < today ? retired : today, recorded.at(-1) ?? ''].sort().at(-1)!;

  const start = parseDateKey(first);
  const count = Math.max(1, differenceInCalendarDays(parseDateKey(last), start) + 1);
  const days: ChartDay[] = [];
  /* `pendingTask`'s rule, as one forward pass instead of a ninety-day walk per day: the occurrences
     since the last completion, of which the oldest still inside the carry window is the one owed. */
  const owed: number[] = [];
  let head = 0;
  for (let i = 0; i < count; i++) {
    const date = addDays(start, i);
    const key = toDateKey(date);
    const value = history.get(key)?.[habit.id] ?? 0;
    const config = configAt(habit, key);
    const occurs = habitOccursOn(habit, key);
    if (occurs) owed.push(i);
    while (head < owed.length && owed[head] <= i - TASK_CARRY_DAYS) head++;
    const overdueFrom =
      isTask(habit) && !value && head < owed.length && (owed[head] < i || key < today)
        ? toDateKey(addDays(start, owed[head]))
        : undefined;
    if (value > 0) head = owed.length; // a completion clears everything behind it
    days.push({
      key,
      weekday: date.getDay(),
      monthDay: date.getDate(),
      value,
      asked: value > 0 || occurs,
      met: metTarget(habit, value, key),
      ...(habit.type === 'numeric' || habit.type === 'time' ? { target: config.target } : {}),
      ...(habit.type === 'scale' || habit.type === 'mood' ? scaleBounds(habit, key) : {}),
      ...(overdueFrom ? { overdueFrom } : {}),
    });
  }
  return days;
}

export type Grain = 'day' | 'week' | 'month';

/** Below this many pixels a bar stops being worth drawing on its own and days are grouped. */
const MIN_BAR_PX = 5;

/** The finest grouping that still gives each bar room to be seen. */
export function pickGrain(visibleDays: number, widthPx: number): Grain {
  const perDay = widthPx / Math.max(1, visibleDays);
  if (perDay >= MIN_BAR_PX) return 'day';
  if (perDay * 7 >= MIN_BAR_PX) return 'week';
  return 'month';
}

export interface Bucket {
  /** Day indices into the lifetime, `end` exclusive. */
  start: number;
  end: number;
  /**
   * What the bar's height means, per kind:
   *   checkbox        the share of asked days that were done, 0–1
   *   numeric / time  the average per asked day, in stored units
   *   scale / mood    the average per asked day as a share of its scale's top, 0–1 — a day left
   *                   unrated counts as 0, below the lowest rating
   * Null when there is nothing to say — no asked day, or (for a scale) nothing recorded.
   */
  y: number | null;
  /** Scale and mood: the raw average, for the readout. Numeric and time: the same as `y`. */
  average: number | null;
  asked: number;
  /** Tasks: days spent owing it — see `ChartDay.overdueFrom`. */
  overdue: number;
  recorded: number;
  met: number;
  /** Numeric and time: the goal in force on the bucket's last day. */
  target?: number;
  /** Scale and mood: the top of the scale on the bucket's last day. */
  max?: number;
}

/** Where the group containing day `index` starts — aligned to weeks and months, not to the data. */
function groupStart(days: readonly ChartDay[], index: number, grain: Grain, weekStart: WeekStart) {
  if (grain === 'day') return index;
  const day = days[index];
  const back = grain === 'week' ? (day.weekday - weekStart + 7) % 7 : day.monthDay - 1;
  return Math.max(0, index - back);
}

/**
 * The bars covering days `[from, to)`, and only those — the chart asks for what is on screen, so a
 * five-year habit zoomed into a fortnight aggregates fourteen days, not eighteen hundred.
 */
export function bucketize(
  habit: Habit,
  days: readonly ChartDay[],
  from: number,
  to: number,
  grain: Grain,
  weekStart: WeekStart,
): Bucket[] {
  const buckets: Bucket[] = [];
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.min(days.length, Math.ceil(to));
  if (lo >= hi) return buckets;

  let start = groupStart(days, lo, grain, weekStart);
  while (start < hi) {
    let end = start + 1;
    while (end < days.length && groupStart(days, end, grain, weekStart) === start) end++;
    buckets.push(summarize(habit, days, start, end));
    start = end;
  }
  return buckets;
}

function summarize(habit: Habit, days: readonly ChartDay[], start: number, end: number): Bucket {
  let asked = 0;
  let overdue = 0;
  let recorded = 0;
  let met = 0;
  let sum = 0;
  let share = 0;
  for (let i = start; i < end; i++) {
    const day = days[i];
    if (day.asked) asked++;
    if (day.overdueFrom) overdue++;
    if (day.met) met++;
    if (day.value > 0) {
      recorded++;
      sum += day.value;
      if (day.max) share += day.value / day.max;
    }
  }
  const last = days[end - 1];
  const base = { start, end, asked, overdue, recorded, met, target: last.target, max: last.max };

  if (isCheckbox(habit.type)) {
    const y = asked ? met / asked : null;
    return { ...base, y, average: y };
  }
  if (habit.type === 'scale' || habit.type === 'mood') {
    /* Each value as a share of the scale it was recorded on, so a 4/5 and an 8/10 either side of
       an edit to the bounds stand at the same height. Averaged over the asked days, with a day
       left unrated as 0: the line drops where the habit was skipped instead of skipping over it. */
    return {
      ...base,
      y: asked ? share / asked : null,
      average: asked ? sum / asked : null,
    };
  }
  /* Per asked day, counting the empty ones: a week of one huge day and six blanks is not a week
     that averaged the huge day. A single unasked day that was answered anyway still gets its bar. */
  const y = asked ? sum / asked : null;
  return { ...base, y, average: y };
}

/** A run of met days, as day indices into the lifetime — `end` is one past the last met day. */
export interface Run {
  start: number;
  end: number;
  /** How many days in it were met: the streak the badge would have shown at its end. */
  met: number;
}

/**
 * Every streak a habit ever had, by the badge's own rule: a day it wasn't asked on is stepped over,
 * and only an asked day left undone ends a run. See `currentStreak` in streaks.ts.
 */
export function streakRuns(days: readonly ChartDay[]): Run[] {
  const runs: Run[] = [];
  let current: Run | undefined;
  days.forEach((day, i) => {
    if (day.met) {
      if (current) {
        current.end = i + 1;
        current.met++;
      } else current = { start: i, end: i + 1, met: 1 };
    } else if (day.asked && current) {
      runs.push(current);
      current = undefined;
    }
  });
  if (current) runs.push(current);
  return runs;
}
