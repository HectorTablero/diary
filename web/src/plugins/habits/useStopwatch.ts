import { useCallback, useEffect, useRef, useState } from 'react';
import { isNative } from '@/lib/native';
import { getPluginPreference, setPluginPreference } from '../reminders';
import { readTimers, writeTimer } from './widgetBridge';

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
 * ## Two stores, on a device with a widget
 *
 * localStorage stays the synchronous one — this hook needs an answer during render, and the card
 * would otherwise show every timer as stopped for a frame before correcting itself. But the home
 * screen widget cannot reach localStorage at all, so the same instant is mirrored into
 * SharedPreferences (see TIMER_PREFIX in widgetBridge.ts), which both processes can write.
 *
 * The mirror is authoritative on arrival, not on write: an effect reconciles from it whenever the
 * habit or the day changes, so a session started on the home screen is adopted here rather than
 * competing with it. Without that the two would each bank their own elapsed time and the day would
 * end up with the session counted twice.
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
  // So the async reconcile below can compare against the current value without re-running whenever
  // the timer ticks.
  const current = useRef(startedAt);
  current.current = startedAt;

  // Re-read when the habit or the day changes: a timer belongs to the day it was started on.
  useEffect(() => {
    setStartedAt(readStart(habitId, dateKey));
  }, [habitId, dateKey]);

  /* Adopt a session the widget started. The shared store is the one both processes can write, so it
     wins over the local mirror rather than being merged with it — two timers for one habit is the
     state that would bank the same minutes twice. */
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    void readTimers().then((timers) => {
      if (cancelled) return;
      const shared = timers.get(habitId);
      const at = shared && shared.dateKey === dateKey ? shared.startedAt : 0;
      if (at === current.current) return;
      setPluginPreference('habits', key(habitId, dateKey), at);
      setStartedAt(at);
      setNow(Date.now());
    });
    return () => {
      cancelled = true;
    };
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
    // Not awaited: the UI moves on the synchronous store, and the widget catching up a moment later
    // is invisible — it repaints on the same refresh the write triggers.
    void writeTimer(habitId, dateKey, at);
    setStartedAt(at);
    setNow(at);
  }, [habitId, dateKey]);

  const stop = useCallback(() => {
    const from = readStart(habitId, dateKey);
    setPluginPreference('habits', key(habitId, dateKey), 0);
    void writeTimer(habitId, dateKey, 0);
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
