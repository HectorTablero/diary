import { useCallback, useEffect, useState } from 'react';
import { getPluginPreference, setPluginPreference } from '../reminders';

/**
 * A running timer for one time habit on one day.
 *
 * ## Why the start time is persisted rather than held in state
 *
 * A stopwatch you can navigate away from is the only kind worth having. Someone starts a
 * twenty-minute reading timer and then opens the calendar, or locks the phone, or the tab is
 * discarded — and a timer that lives in component state loses all of it silently, which is worse
 * than not offering one. So what is stored is the *instant it started*, and the elapsed time is
 * always derived from the clock. Nothing accumulates in memory that a reload can drop.
 *
 * Device-local, in the same store as the plugin's reminder preferences, because that is what a
 * running stopwatch is: you are not holding one on two devices at once, and syncing a start
 * timestamp would mean a second device deciding you had been reading for an hour.
 *
 * Keyed by day as well as habit so a timer left running past midnight stops belonging to yesterday
 * — it is stopped and banked against the day it was started on, which is where the reading happened.
 */
const key = (habitId: string, dateKey: string) => `timer:${dateKey}:${habitId}`;

/** Epoch milliseconds when the timer started, or 0 when it isn't running. */
const readStart = (habitId: string, dateKey: string): number =>
  getPluginPreference('habits', key(habitId, dateKey), 0);

export interface Stopwatch {
  running: boolean;
  /** Seconds accumulated since the timer started; 0 when stopped. */
  elapsed: number;
  start: () => void;
  /** Stops and hands back the seconds to bank. Returns 0 if it wasn't running. */
  stop: () => number;
}

export function useStopwatch(habitId: string, dateKey: string): Stopwatch {
  const [startedAt, setStartedAt] = useState(() => readStart(habitId, dateKey));
  const [now, setNow] = useState(() => Date.now());

  // Re-read when the habit or the day changes: a timer belongs to the day it was started on.
  useEffect(() => {
    setStartedAt(readStart(habitId, dateKey));
  }, [habitId, dateKey]);

  /* One-second tick, only while running. `Date.now()` on every tick rather than a counter, so a
     backgrounded tab that stops firing timers catches up on its next frame instead of under-counting
     by however long it was asleep. */
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const start = useCallback(() => {
    const at = Date.now();
    setPluginPreference('habits', key(habitId, dateKey), at);
    setStartedAt(at);
    setNow(at);
  }, [habitId, dateKey]);

  const stop = useCallback(() => {
    const from = readStart(habitId, dateKey);
    setPluginPreference('habits', key(habitId, dateKey), 0);
    setStartedAt(0);
    if (!from) return 0;
    return Math.max(0, Math.floor((Date.now() - from) / 1000));
  }, [habitId, dateKey]);

  return {
    running: startedAt > 0,
    elapsed: startedAt > 0 ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0,
    start,
    stop,
  };
}
