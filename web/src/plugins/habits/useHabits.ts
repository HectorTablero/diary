import { UNDATED_KEY, type PluginRecordDto } from '@diary/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPluginRecord,
  deletePluginRecord,
  getDayRecords,
  getUndatedRecords,
  putPluginRecord,
  updatePluginRecord,
} from '@/db/pluginRecords';
import { db } from '@/db/db';
import { onSyncApplied } from '@/db/sync';
import {
  habitData,
  configChanged,
  habitAppliesOn,
  habitCreatedBy,
  isArchived,
  MAX_HABITS,
  metTarget,
  parseHabit,
  parseValues,
  sortHabits,
  valueData,
  type Habit,
  type HabitConfig,
} from './model';
import { todayKey } from '@/lib/dates';
import {
  currentStreak,
  dateKeysBetween,
  dateKeyWindow,
  streakBefore,
  STREAK_WINDOW_DAYS,
} from './streaks';
import { refreshHabitsWidget } from './widgetBridge';

const PLUGIN_ID = 'habits';

/**
 * The days this habit's goal was actually *reached*.
 *
 * Not the days it was recorded on. Judged by `metTarget`, so each day is measured against the goal
 * that was in force *then* — raising a goal must not retroactively break a streak, for the same
 * reason it must not repaint the grid.
 */
const metDays = (
  habit: Habit,
  history: ReadonlyMap<string, Record<string, number>>,
): Set<string> => {
  const days = new Set<string>();
  for (const [day, recorded] of history) {
    if (metTarget(habit, recorded[habit.id] ?? 0, day)) days.add(day);
  }
  return days;
};

/**
 * How long recording waits before it writes.
 *
 * Every enqueue kicks a sync *and* runs a full notification reconcile, which reads every person out
 * of Dexie and round-trips the OS for its pending alarms. Running down a checklist, or tapping `+`
 * five times on a count, must not be one of those per press.
 *
 * Coalescing rather than batching, because the writes all target one row: several changes are one
 * final state. The UI moves immediately off local state, and the flush on unmount and on day change
 * is what stops the delay being lossy.
 */
const WRITE_DEBOUNCE_MS = 600;

const definitionsOf = (rows: PluginRecordDto[]): Habit[] =>
  sortHabits(rows.flatMap((row) => parseHabit(row) ?? []));

/* --- The day page ------------------------------------------------------------------------------ */

export interface HabitsDay {
  /** Still being asked about: shown as the day's checklist. */
  active: Habit[];
  /**
   * Archived habits that were nonetheless recorded on *this* day.
   *
   * An archived habit stops being offered, but the days it did happen on keep it — hiding those
   * would make the diary's own record of a week disagree with itself depending on when you looked.
   */
  archivedWithProgress: Habit[];
  values: Record<string, number>;
  /**
   * Each habit's run of met days ending *yesterday* — today deliberately left out.
   *
   * The card adds today's own answer itself, which is the whole point: this map is derived from
   * settled history and does not change while you are recording, so a badge cannot flicker between
   * the optimistic value and the stored one while a debounced write is in flight. See `streakBefore`.
   */
  priorStreaks: ReadonlyMap<string, number>;
  loading: boolean;
  /** Any habit at all, archived or not — the difference between "nothing set up" and "all done". */
  hasAnyHabit: boolean;
  /**
   * Whether *any* habit had already been created by this day — regardless of whether it has since
   * been retired, and regardless of whether it was retired *before* this day too.
   *
   * The distinction the day card needs when both lists come up empty: a habit archived before this
   * day still means something happened here once, and the card should say so ("every habit is
   * retired"); a day that predates the very first habit means the question was never asked at all,
   * and the card should not appear rather than explain an emptiness that isn't really about
   * anything. See `habitCreatedBy` in model.ts.
   */
  anyHabitCreatedByThatDay: boolean;
  setValue: (habitId: string, value: number) => void;
}

export function useHabitsDay(dateKey: string): HabitsDay {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [history, setHistory] = useState<Map<string, Record<string, number>>>(new Map());
  const [values, setValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const pending = useRef<{ dateKey: string; values: Record<string, number> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const write = pending.current;
    pending.current = null;
    if (!write) return;
    await putPluginRecord(PLUGIN_ID, 'record', write.dateKey, valueData(write.values));
    /* Hung off the flush rather than off `setValue`, so the debounce covers this too: running down
       the checklist is one widget repaint at the end, not one per tap. Not awaited and never
       throwing — the home screen catching up a moment late is not worth delaying the write, and a
       widget that failed to repaint is not a reason for a recorded habit to fail. */
    void refreshHabitsWidget();
  }, []);

  const load = useCallback(async () => {
    const window = dateKeyWindow(dateKey, STREAK_WINDOW_DAYS);
    const [definitions, days] = await Promise.all([
      getUndatedRecords(PLUGIN_ID),
      getDayRecords(PLUGIN_ID, window[0], dateKey),
    ]);

    setHabits(definitionsOf(definitions));
    const byDate = new Map(days.map((row) => [row.dateKey, parseValues(row)]));
    setHistory(byDate);
    // Only adopt stored values when nothing local is waiting: a sync landing mid-debounce must not
    // undo a box the user has just ticked.
    if (!pending.current) setValues(byDate.get(dateKey) ?? {});
    setLoading(false);
  }, [dateKey]);

  useEffect(() => {
    setLoading(true);
    void load();
    // The widget reads Dexie directly rather than through the query cache, so a change from another
    // device needs its own subscription.
    return onSyncApplied(() => void load());
  }, [load]);

  useEffect(() => () => void flush(), [dateKey, flush]);

  const setValue = useCallback(
    (habitId: string, value: number) => {
      setValues((current) => {
        const next = { ...current };
        if (value > 0) next[habitId] = value;
        else delete next[habitId];

        pending.current = { dateKey, values: next };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), WRITE_DEBOUNCE_MS);

        /* `history` is deliberately *not* patched with today. Nothing reads today out of it — the
           streak base stops at yesterday and the card holds today in `values` — and mirroring the
           value into two places is exactly what made the badge flicker: one copy was overwritten by
           the reload the write triggers, the other wasn't. */
        return next;
      });
    },
    [dateKey, flush],
  );

  const priorStreaks = useMemo(() => {
    const result = new Map<string, number>();
    for (const habit of habits)
      result.set(habit.id, streakBefore(metDays(habit, history), dateKey));
    return result;
  }, [habits, history, dateKey]);

  // `habitCreatedBy` rather than just `!isArchived`: a habit created after this day was not being
  // asked about on it, and showing it as an unchecked box would be asking the day a question it
  // never actually posed. (The archival half of `habitAppliesOn` is a no-op here, since
  // `!isArchived` already excludes every currently-retired habit.)
  const active = habits.filter((habit) => !isArchived(habit) && habitCreatedBy(habit, dateKey));
  const archivedWithProgress = habits.filter(
    (habit) => isArchived(habit) && (values[habit.id] ?? 0) > 0,
  );

  return {
    active,
    archivedWithProgress,
    values,
    priorStreaks,
    loading,
    hasAnyHabit: habits.length > 0,
    // Distinguishes "every habit is retired" from "no habit created yet" — both leave the card's
    // two lists empty, but one is a fact worth stating and the other is a question this day never
    // asked. `habitCreatedBy` rather than `habitAppliesOn`: a habit archived before this day still
    // counts here, so its retirement gets said out loud instead of the card vanishing.
    anyHabitCreatedByThatDay: habits.some((habit) => habitCreatedBy(habit, dateKey)),
    setValue,
  };
}

/* --- The habits page --------------------------------------------------------------------------- */

export interface HabitsLibrary {
  active: Habit[];
  archived: Habit[];
  /** How many days each habit was ever recorded on. Zero is what makes deleting it safe. */
  progress: ReadonlyMap<string, number>;
  history: ReadonlyMap<string, Record<string, number>>;
  streaks: ReadonlyMap<string, number>;
  loading: boolean;
  atLimit: boolean;
  addHabit: (
    habit: Omit<Habit, 'id' | 'order' | 'archivedAt' | 'since' | 'revisions'>,
  ) => Promise<void>;
  /** Edits the configurable half of a habit, banking what it replaced. */
  editHabit: (habit: Habit, config: HabitConfig) => Promise<void>;
  setArchived: (habit: Habit, archived: boolean) => Promise<void>;
  /** Only legal for a habit with no recorded days; the UI offers archiving instead. */
  deleteHabit: (habit: Habit) => Promise<void>;
}

/**
 * Every habit and every day it was recorded on.
 *
 * Reads the plugin's whole table rather than a window, because the two questions this page answers
 * — "can this be deleted" and "how has it been going" — are both about all of history. It is one
 * indexed scan of small rows (a day each, so a few hundred a year) on a page opened deliberately.
 */
export function useHabitsLibrary(today: string): HabitsLibrary {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [history, setHistory] = useState<Map<string, Record<string, number>>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const rows = await db.pluginRecords.where('pluginId').equals(PLUGIN_ID).toArray();
    const undated = rows.filter((row) => row.scope === 'record' && row.dateKey === UNDATED_KEY);
    const days = rows.filter((row) => row.scope === 'record' && row.dateKey !== UNDATED_KEY);

    setHabits(definitionsOf(undated));
    setHistory(new Map(days.map((row) => [row.dateKey, parseValues(row)])));
    setLoading(false);
    /* Here rather than in each of the four mutations below, all of which end by calling this. The
       home screen has to follow a habit being created, renamed, retired or brought back, not just
       being ticked — a widget still listing a habit that was retired an hour ago is the kind of
       staleness people report as data loss. The cost of also firing on mount is one repaint on a
       page that was opened deliberately. */
    void refreshHabitsWidget();
  }, []);

  useEffect(() => {
    void load();
    return onSyncApplied(() => void load());
  }, [load]);

  const progress = useMemo(() => {
    const counts = new Map<string, number>();
    for (const recorded of history.values()) {
      for (const [habitId, value] of Object.entries(recorded)) {
        if (value > 0) counts.set(habitId, (counts.get(habitId) ?? 0) + 1);
      }
    }
    return counts;
  }, [history]);

  const streaks = useMemo(() => {
    const result = new Map<string, number>();
    for (const habit of habits) result.set(habit.id, currentStreak(metDays(habit, history), today));
    return result;
  }, [habits, history, today]);

  const addHabit = useCallback(
    async (habit: Omit<Habit, 'id' | 'order' | 'archivedAt' | 'since' | 'revisions'>) => {
      if (habits.length >= MAX_HABITS) return;
      const order = habits.length ? Math.max(...habits.map((h) => h.order)) + 1 : 0;
      await createPluginRecord(
        PLUGIN_ID,
        'record',
        UNDATED_KEY,
        habitData({ ...habit, since: todayKey(), revisions: [], order, archivedAt: null }),
      );
      await load();
    },
    [habits, load],
  );

  /**
   * Change a habit's name, unit, goal or bounds — additively.
   *
   * The configuration being replaced is pushed onto `revisions` with the day it started applying,
   * and the new one takes effect from today. Nothing about any past day changes: raising a goal from
   * 50 to 100 leaves every day you hit 50 recorded as met, because those days are still judged by
   * the goal that was in force then. See the note on `revisions` in model.ts.
   */
  const editHabit = useCallback(
    async (habit: Habit, config: HabitConfig) => {
      const name = config.name.trim();
      if (!name) return;
      const next: HabitConfig = { ...config, name };
      if (!configChanged(habit, next)) return;

      const today = todayKey();
      /* Two edits on the same day replace each other rather than stacking: the intermediate value
         never applied to a whole day, so recording it would put a change in the log that nobody
         made a decision about. */
      const revisions =
        habit.since === today
          ? habit.revisions
          : [
              ...habit.revisions,
              {
                since: habit.since || today,
                changedAt: new Date().toISOString(),
                name: habit.name,
                unit: habit.unit,
                target: habit.target,
                min: habit.min,
                max: habit.max,
              },
            ];

      await updatePluginRecord(habit.id, habitData({ ...habit, ...next, since: today, revisions }));
      await load();
    },
    [load],
  );

  const setArchived = useCallback(
    async (habit: Habit, archived: boolean) => {
      await updatePluginRecord(
        habit.id,
        habitData({ ...habit, archivedAt: archived ? new Date().toISOString() : null }),
      );
      await load();
    },
    [load],
  );

  const deleteHabit = useCallback(
    async (habit: Habit) => {
      /* Guarded here as well as in the UI. A habit with recorded days must not be deletable by any
         path — the days are diary history, and there is no undo for this. */
      if ((progress.get(habit.id) ?? 0) > 0) return;
      await deletePluginRecord(habit.id);
      await load();
    },
    [progress, load],
  );

  return {
    active: habits.filter((habit) => !isArchived(habit)),
    archived: habits.filter(isArchived),
    progress,
    history,
    streaks,
    loading,
    atLimit: habits.length >= MAX_HABITS,
    addHabit,
    editHabit,
    setArchived,
    deleteHabit,
  };
}

/* --- The calendar view ------------------------------------------------------------------------- */

/** One day's ratio, before it becomes a `PluginCalendarDay` — kept as plain numbers here so this
    file stays free of `t()`, same split as everywhere else in the plugin: data here, strings in
    the component. */
export interface HabitDayRatio {
  met: number;
  total: number;
}

/**
 * Each day of a month range, scored as "how many of that day's habits were met".
 *
 * Bounded by `start`/`end` rather than counting back from today, since the calendar can be any
 * month — and a range read is one indexed scan, the same shape as the window `useHabitsDay` reads
 * for streaks. Only habits `habitAppliesOn` that day count toward the denominator, which is what
 * keeps a day before a habit existed, or after it was retired, from watering down every other day's
 * ratio.
 */
export function useHabitsCalendar(start: string, end: string): ReadonlyMap<string, HabitDayRatio> {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [history, setHistory] = useState<Map<string, Record<string, number>>>(new Map());

  const load = useCallback(async () => {
    const [definitions, days] = await Promise.all([
      getUndatedRecords(PLUGIN_ID),
      getDayRecords(PLUGIN_ID, start, end),
    ]);
    setHabits(definitionsOf(definitions));
    setHistory(new Map(days.map((row) => [row.dateKey, parseValues(row)])));
  }, [start, end]);

  useEffect(() => {
    void load();
    return onSyncApplied(() => void load());
  }, [load]);

  return useMemo(() => {
    const data = new Map<string, HabitDayRatio>();
    for (const day of dateKeysBetween(start, end)) {
      const applicable = habits.filter((habit) => habitAppliesOn(habit, day));
      if (!applicable.length) continue; // nothing was being tracked yet — not a day of zero
      const recorded = history.get(day) ?? {};
      const met = applicable.filter((habit) =>
        metTarget(habit, recorded[habit.id] ?? 0, day),
      ).length;
      data.set(day, { met, total: applicable.length });
    }
    return data;
  }, [habits, history, start, end]);
}
