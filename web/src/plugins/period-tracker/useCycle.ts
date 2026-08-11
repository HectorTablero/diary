import type { PluginRecordDto } from '@diary/shared';
import { addDays } from 'date-fns';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/db/db';
import {
  deletePluginRecord,
  getDayRecord,
  getDayRecords,
  putPluginRecord,
  putPluginRecords,
} from '@/db/pluginRecords';
import { onSyncApplied } from '@/db/sync';
import { parseDateKey, toDateKey, todayKey } from '@/lib/dates';
import {
  CALENDAR_LEVEL,
  DEFAULT_FLOW,
  parsePeriodDay,
  periodDayData,
  PREDICTED_CALENDAR_LEVEL,
  type FlowLevel,
  type PeriodDay,
} from './model';
import {
  dateKeysBetween,
  groupCycles,
  outlookFor,
  predictNext,
  recentStats,
  type Cycle,
  type PeriodOutlook,
  type RecentStats,
} from './predict';

const PLUGIN_ID = 'period-tracker';

/**
 * How far back the day widget reads to build a prediction.
 *
 * Bounded, like habits' `STREAK_WINDOW_DAYS`, rather than reading every row ever written — but wider,
 * because a prediction wants up to six *cycles* of history and a cycle can span a couple of months,
 * where a streak only ever looks back at most 90 days. A bit over a year comfortably covers six
 * cycles even for someone whose cycle runs long, and if it ever doesn't, `predictNext` just works
 * from fewer of them — never from stale ones, since this always ends at today.
 */
const HISTORY_WINDOW_DAYS = 400;

/* --- The day page --------------------------------------------------------------------------- */

export interface PeriodDayState {
  /** This day's own record, if it was marked. */
  day: PeriodDay | undefined;
  /**
   * What to say about a day that has *not* been marked. Always `{ kind: 'none' }` for a day before
   * today — see the note on PeriodDayWidget for why a prediction never speaks about the past, which
   * is always either a marked day or a day nothing happened on, and both are already certain.
   */
  outlook: PeriodOutlook;
  /**
   * Whether yesterday — relative to the *real* today, regardless of which day is being viewed — was
   * itself a marked period day, with nothing recorded since. A run that is still open, waiting on
   * today to say whether it continues.
   *
   * Only meaningful for today's own widget: a past day already has its own settled answer, and a
   * future day cannot continue a run that hasn't reached it yet.
   */
  ongoing: boolean;
  loading: boolean;
  /** `null` unmarks the day; otherwise marks it (or changes its flow, if already marked). */
  setFlow: (flow: FlowLevel | null) => Promise<void>;
}

export function usePeriodDay(dateKey: string): PeriodDayState {
  const today = todayKey();
  const [day, setDay] = useState<PeriodDay | undefined>(undefined);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const windowStart = toDateKey(addDays(parseDateKey(today), -HISTORY_WINDOW_DAYS));
    const [dayRow, historyRows] = await Promise.all([
      getDayRecord(PLUGIN_ID, dateKey),
      getDayRecords(PLUGIN_ID, windowStart, today),
    ]);
    setDay(parsePeriodDay(dayRow));
    const marked = historyRows.flatMap((row) => (parsePeriodDay(row) ? [row.dateKey] : []));
    setCycles(groupCycles(marked));
    setLoading(false);
  }, [dateKey, today]);

  useEffect(() => {
    setLoading(true);
    void load();
    return onSyncApplied(() => void load());
  }, [load]);

  // A prediction is never asked about a day that has already happened: the day is either marked
  // (certain) or it isn't (also certain, by omission) — there is nothing left for a guess to add.
  const outlook = useMemo(
    () =>
      dateKey < today ? ({ kind: 'none' } as const) : outlookFor(dateKey, predictNext(cycles)),
    [dateKey, today, cycles],
  );

  // Only the *most recent* cycle can possibly still be open — cycles are historical and
  // non-overlapping — so this only ever has to look at the last one.
  const ongoing = useMemo(() => {
    const yesterday = toDateKey(addDays(parseDateKey(today), -1));
    return cycles.length > 0 && cycles[cycles.length - 1].end === yesterday;
  }, [cycles, today]);

  const setFlow = useCallback(
    async (flow: FlowLevel | null) => {
      if (flow) {
        await putPluginRecord(PLUGIN_ID, 'record', dateKey, periodDayData(flow));
      } else {
        const existing = await getDayRecord(PLUGIN_ID, dateKey);
        if (existing) await deletePluginRecord(existing.id);
      }
      await load();
    },
    [dateKey, load],
  );

  return { day, outlook, ongoing, loading, setFlow };
}

/* --- The calendar view ------------------------------------------------------------------------- */

export interface PeriodCalendarDay {
  level: number;
  flow?: FlowLevel;
  /** Whether this day was actually logged, as opposed to falling inside the predicted window. */
  confirmed: boolean;
}

/**
 * Every marked or predicted day of a month range.
 *
 * Reads the plugin's whole table rather than a window, unlike the day widget: browsing to a month
 * from three years ago still has to show what was actually logged then, and only a full read can
 * answer that. The plugin's own row count is small enough (see MAX_PLUGIN_RECORDS_PER_PLUGIN in
 * shared/constants.ts) that this is one indexed scan, not a real cost — the same trade
 * `useHabitsLibrary` makes for its page.
 */
export function usePeriodCalendar(
  start: string,
  end: string,
): ReadonlyMap<string, PeriodCalendarDay> {
  const [rows, setRows] = useState<PluginRecordDto[]>([]);

  const load = useCallback(async () => {
    const all = await db.pluginRecords
      .where('[pluginId+scope]')
      .equals([PLUGIN_ID, 'record'])
      .toArray();
    setRows(all);
  }, []);

  useEffect(() => {
    void load();
    return onSyncApplied(() => void load());
  }, [load]);

  return useMemo(() => {
    const byDate = new Map<string, PeriodDay>();
    for (const row of rows) {
      const parsed = parsePeriodDay(row);
      if (parsed) byDate.set(row.dateKey, parsed);
    }
    const prediction = predictNext(groupCycles(byDate.keys()));

    const data = new Map<string, PeriodCalendarDay>();
    for (const day of dateKeysBetween(start, end)) {
      const marked = byDate.get(day);
      if (marked) {
        data.set(day, { level: CALENDAR_LEVEL[marked.flow], flow: marked.flow, confirmed: true });
      } else if (prediction && day >= prediction.start && day <= prediction.end) {
        data.set(day, { level: PREDICTED_CALENDAR_LEVEL, confirmed: false });
      }
    }
    return data;
  }, [rows, start, end]);
}

/* --- The plugin's own page ----------------------------------------------------------------------- */

export interface PeriodHistory {
  /** Most recent first — the order a history is read in. */
  cycles: readonly Cycle[];
  /** Every logged day's own flow, keyed by dateKey — what a cycle card's expanded day list reads
      from, and what an edit form seeds its per-day defaults with. */
  byDate: ReadonlyMap<string, PeriodDay>;
  /** `undefined` below two logged cycles — see `recentStats`. */
  stats: RecentStats | undefined;
  loading: boolean;
  /** Erases every day of one logged cycle. There is no partial edit here: the page corrects a whole
      mistaken entry rather than picking at individual days, which belongs to the day widget instead. */
  deleteCycle: (cycle: Cycle) => Promise<void>;
  /**
   * Records a past period the day widget never got a chance to: every day from `start` to `end`
   * (inclusive), each with the flow `flowByDay` names for it or `DEFAULT_FLOW` where it names none.
   * A single batched write — one sync kick for the whole period, not one per day.
   */
  addPeriod: (
    start: string,
    end: string,
    flowByDay: ReadonlyMap<string, FlowLevel>,
  ) => Promise<void>;
  /**
   * Replaces one logged cycle's range and per-day flows wholesale: every day of `cycle` is deleted,
   * then every day from `start` to `end` is written fresh. A full replace rather than a diff against
   * the old range — a period is short enough that this costs nothing, and it means there is exactly
   * one code path that decides what a range of days ends up holding, shared with `addPeriod`.
   */
  editCycle: (
    cycle: Cycle,
    start: string,
    end: string,
    flowByDay: ReadonlyMap<string, FlowLevel>,
  ) => Promise<void>;
  /** Changes one already-logged day's flow in place, without touching its neighbours — the quick
      edit a cycle card's expanded day list offers, as opposed to `editCycle`'s wholesale replace. */
  setDayFlow: (dateKey: string, flow: FlowLevel) => Promise<void>;
}

export function usePeriodHistory(): PeriodHistory {
  const [rows, setRows] = useState<PluginRecordDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const all = await db.pluginRecords
      .where('[pluginId+scope]')
      .equals([PLUGIN_ID, 'record'])
      .toArray();
    setRows(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    return onSyncApplied(() => void load());
  }, [load]);

  const byDate = useMemo(() => {
    const map = new Map<string, PeriodDay>();
    for (const row of rows) {
      const parsed = parsePeriodDay(row);
      if (parsed) map.set(row.dateKey, parsed);
    }
    return map;
  }, [rows]);

  // Chronological for the averaging `recentStats` does (it reads the *most recent* end of the
  // array); `cycles` below is the reverse of it, the order the page actually wants to list them in.
  const chronological = useMemo(() => groupCycles(byDate.keys()), [byDate]);
  const stats = useMemo(() => recentStats(chronological), [chronological]);
  const cycles = useMemo(() => [...chronological].reverse(), [chronological]);

  const deleteCycle = useCallback(
    async (cycle: Cycle) => {
      const ids = rows
        .filter((row) => row.dateKey >= cycle.start && row.dateKey <= cycle.end)
        .map((row) => row.id);
      await Promise.all(ids.map((id) => deletePluginRecord(id)));
      await load();
    },
    [rows, load],
  );

  // Shared by addPeriod and editCycle: what a range of days is written as, given the flow named for
  // each or the default where none was named.
  const writeDays = useCallback(
    (start: string, end: string, flowByDay: ReadonlyMap<string, FlowLevel>) =>
      putPluginRecords(
        dateKeysBetween(start, end).map((dateKey) => ({
          pluginId: PLUGIN_ID,
          scope: 'record' as const,
          dateKey,
          data: periodDayData(flowByDay.get(dateKey) ?? DEFAULT_FLOW),
        })),
      ),
    [],
  );

  const addPeriod = useCallback(
    async (start: string, end: string, flowByDay: ReadonlyMap<string, FlowLevel>) => {
      await writeDays(start, end, flowByDay);
      await load();
    },
    [writeDays, load],
  );

  const editCycle = useCallback(
    async (cycle: Cycle, start: string, end: string, flowByDay: ReadonlyMap<string, FlowLevel>) => {
      const oldIds = rows
        .filter((row) => row.dateKey >= cycle.start && row.dateKey <= cycle.end)
        .map((row) => row.id);
      await Promise.all(oldIds.map((id) => deletePluginRecord(id)));
      await writeDays(start, end, flowByDay);
      await load();
    },
    [rows, writeDays, load],
  );

  const setDayFlow = useCallback(
    async (dateKey: string, flow: FlowLevel) => {
      await putPluginRecord(PLUGIN_ID, 'record', dateKey, periodDayData(flow));
      await load();
    },
    [load],
  );

  return { cycles, byDate, stats, loading, deleteCycle, addPeriod, editCycle, setDayFlow };
}
