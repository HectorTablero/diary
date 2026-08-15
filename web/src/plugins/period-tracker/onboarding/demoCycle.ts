import { addDays, subDays } from 'date-fns';
import { parseDateKey, toDateKey, todayKey } from '@/lib/dates';
import type { Cycle } from '../predict';
import type { FlowLevel } from '../model';

/** One cycle's worth of flow, oldest day first — shared by `demoCycle` (CyclePageStep) and
    CalendarStep, so the tour's one fabricated period reads as the same period wherever it's shown
    rather than a fresh invention per screen. Varies day to day, heaviest first tapering to
    lightest, for the same reason TypesStep varies its habit values: a tour that showed one level
    five times would not demonstrate that there are three of them. */
export const DEMO_FLOW_SEQUENCE: readonly FlowLevel[] = [
  'heavy',
  'heavy',
  'medium',
  'medium',
  'light',
];

/**
 * A fabricated five-day period, three weeks back — recent enough to read as "the last one", far
 * enough that the plugin's own "may arrive soon" warning (see DayWarningsStep, which fabricates a
 * *separate* prediction) reads as a different, still-future event rather than contradicting it.
 */
export function demoCycle(): { cycle: Cycle; byDate: Map<string, { flow: FlowLevel }> } {
  const today = parseDateKey(todayKey());
  const start = toDateKey(subDays(today, 20));

  const byDate = new Map<string, { flow: FlowLevel }>();
  let cursor = parseDateKey(start);
  for (const flow of DEMO_FLOW_SEQUENCE) {
    byDate.set(toDateKey(cursor), { flow });
    cursor = addDays(cursor, 1);
  }

  const end = toDateKey(addDays(parseDateKey(start), DEMO_FLOW_SEQUENCE.length - 1));
  return { cycle: { start, end }, byDate };
}
