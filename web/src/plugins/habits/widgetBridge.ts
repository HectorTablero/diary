import { Preferences } from '@capacitor/preferences';
import {
  getDayRecord,
  getDayRecords,
  getUndatedRecords,
  putPluginRecord,
} from '@/db/pluginRecords';
import { todayKey } from '@/lib/dates';
import { isNative } from '@/lib/native';
import { captureError } from '@/lib/telemetry';
import i18n from '@/i18n';
import { isPluginEnabled } from '../enabled';
import { HabitsWidget } from './widgetPlugin';
import {
  habitAppliesOn,
  isArchived,
  metTarget,
  parseHabit,
  parseValues,
  scaleBounds,
  sortHabits,
  valueData,
  type Habit,
} from './model';
import { currentStreak, dateKeyWindow, STREAK_WINDOW_DAYS } from './streaks';
import { buildSnapshot, type WidgetSnapshot, type WidgetStrings } from './widgetSnapshot';

/**
 * The two-way contract between the web app and the Android home-screen widget.
 *
 * ## Why SharedPreferences, and why nothing new had to be built for it
 *
 * The widget runs outside the WebView, so it cannot reach Dexie — IndexedDB is a private store with
 * no native API. Some mirror was always going to be needed. What makes it cheap is that
 * `@capacitor/preferences` is already a dependency and its Android half is a one-liner:
 *
 *     context.getSharedPreferences("CapacitorStorage", MODE_PRIVATE)   // Preferences.java
 *
 * So a `Preferences.set` from here is a `getString` from the provider, with no plugin in between and
 * no third-party bridge package. The same file both sides open is the whole transport.
 *
 * ## Deltas going back, not values
 *
 * The read direction is a snapshot: whatever Dexie says is true, restated for a renderer. The write
 * direction cannot be, and this is the part worth being careful about.
 *
 * A widget holding a snapshot from an hour ago that posts back "this habit is now 40" would undo a
 * change made on another device in the meantime — it would be asserting a total it computed from a
 * stale base. So a press writes what it *did* ("+5"), never what it thinks the answer is, and the
 * total is only ever computed here, against whatever Dexie holds at the moment of draining. That is
 * the same posture `revisions` takes in model.ts: record the change, derive the state.
 *
 * ## One key per op
 *
 * Both processes write this file, and neither can lock the other out. A single JSON array would be
 * a read-modify-write from two writers — a press landing while the app is mid-drain would be lost,
 * and the failure is invisible because the widget already showed it as applied.
 *
 * So each press is its own key, `habits.widget.op.<opId>`. Appending is a write to a key nobody
 * else touches, and draining is a read of the keys that existed when the drain started, each
 * removed only once its delta is banked. A press made during a drain is simply drained next time.
 */

const PLUGIN_ID = 'habits';

/** The snapshot the provider draws. One key, replaced whole on every refresh. */
export const SNAPSHOT_KEY = 'habits.widget';
/** Prefix for a single un-drained press. See the note on one-key-per-op above. */
export const OP_PREFIX = 'habits.widget.op.';
/**
 * Prefix for a running stopwatch, one key per habit: `{ dateKey, startedAt }`.
 *
 * The one piece of state both processes *write* rather than one writing and the other reading, and
 * it has to be: a session started on the home screen must be pausable in the app and the other way
 * round. Living here rather than in localStorage is what makes that possible at all — the widget
 * cannot reach localStorage, and a timer the app could not see would double-count the moment both
 * banked it.
 *
 * Only the start instant is stored, never an elapsed count. Same reasoning as `useStopwatch`: a
 * number derived from the clock cannot drift while a process is asleep, and nothing is lost if
 * either side is killed mid-session.
 */
export const TIMER_PREFIX = 'habits.widget.timer.';

/** A running stopwatch, as both sides store it. */
export interface WidgetTimer {
  dateKey: string;
  /** Epoch milliseconds. */
  startedAt: number;
}

/** Read every running stopwatch, by habit id. Absent means not running. */
export async function readTimers(): Promise<Map<string, WidgetTimer>> {
  const timers = new Map<string, WidgetTimer>();
  if (!isNative) return timers;
  const { keys } = await Preferences.keys();
  for (const key of keys.filter((candidate) => candidate.startsWith(TIMER_PREFIX))) {
    const { value } = await Preferences.get({ key });
    if (!value) continue;
    try {
      const parsed = JSON.parse(value) as Partial<WidgetTimer>;
      if (typeof parsed.dateKey === 'string' && typeof parsed.startedAt === 'number') {
        timers.set(key.slice(TIMER_PREFIX.length), parsed as WidgetTimer);
      }
    } catch {
      await Preferences.remove({ key });
    }
  }
  return timers;
}

/** Start or clear one habit's stopwatch. `startedAt` of 0 clears it. */
export async function writeTimer(
  habitId: string,
  dateKey: string,
  startedAt: number,
): Promise<void> {
  if (!isNative) return;
  const key = `${TIMER_PREFIX}${habitId}`;
  if (startedAt > 0) await Preferences.set({ key, value: JSON.stringify({ dateKey, startedAt }) });
  else await Preferences.remove({ key });
}

/** A press on the widget, waiting to be banked. Written by `HabitsWidgetStore.java`. */
interface WidgetOp {
  habitId: string;
  dateKey: string;
  /** Signed, in the habit's stored units. Seconds for a duration, ±1 for a binary toggle. */
  delta: number;
}

const strings = (): WidgetStrings => ({
  title: i18n.t('plugins.habits.title'),
  done: i18n.t('plugins.habits.widgetDone'),
  notDone: i18n.t('plugins.habits.widgetNotDone'),
  markDone: i18n.t('plugins.habits.markDone'),
  empty: i18n.t('plugins.habits.empty'),
  nothingToday: i18n.t('plugins.habits.widgetNothingToday'),
});

/** The set of days each habit's goal was actually reached — the streak base. Mirrors the private
    `metDays` in useHabits.ts; kept separate because this module must not pull in React. */
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
 * Read today out of Dexie and restate it for the widget.
 *
 * Reads the same 90-day window `useHabitsDay` reads, for the same reason — a streak is the one
 * thing on the card that cannot be answered from today's row alone — and it is one indexed scan of
 * small rows, run on resume rather than on a timer.
 *
 * Streaks include today (`currentStreak`, not `streakBefore`), because unlike the day card there is
 * no local optimistic value to add on top: the widget is drawing settled state.
 */
async function readSnapshot(): Promise<WidgetSnapshot> {
  const dateKey = todayKey();
  const window = dateKeyWindow(dateKey, STREAK_WINDOW_DAYS);
  const [definitions, days] = await Promise.all([
    getUndatedRecords(PLUGIN_ID),
    getDayRecords(PLUGIN_ID, window[0], dateKey),
  ]);

  const habits = sortHabits(definitions.flatMap((row) => parseHabit(row) ?? []));
  const history = new Map(days.map((row) => [row.dateKey, parseValues(row)]));
  const values = history.get(dateKey) ?? {};

  /* `habitAppliesOn` rather than `!isArchived`: the widget only ever shows today, and a habit
     retired yesterday is not a question today is asking. It also drops habits created later than
     today, which cannot happen for a real clock but can for a device whose date was wound back. */
  const active = habits.filter((habit) => !isArchived(habit) && habitAppliesOn(habit, dateKey));

  const streaks = new Map(
    active.map((habit) => [habit.id, currentStreak(metDays(habit, history), dateKey)]),
  );

  const timers = await readTimers();
  const running = new Map(
    [...timers].flatMap(([habitId, timer]) =>
      // A timer belongs to the day it was started on, exactly as `useStopwatch` keys it. One left
      // running past midnight is banked by the drain, not shown as today's.
      timer.dateKey === dateKey ? [[habitId, timer.startedAt] as const] : [],
    ),
  );

  const text = strings();
  // Distinguishes "nothing set up" from "nothing being asked today", the same split the day card
  // makes between `empty` and `allRetired`. The provider shows whichever string is non-empty.
  return buildSnapshot(
    dateKey,
    active,
    values,
    streaks,
    { ...text, empty: habits.length === 0 ? text.empty : text.nothingToday },
    running,
  );
}

/**
 * Push the current state to the widget.
 *
 * Safe to call often and from anywhere — it is a no-op off-device, and it writes one small string
 * plus one broadcast. Never throws: a widget that failed to refresh must not take down the caller
 * that was doing something else, so failures are reported and swallowed.
 */
export async function refreshHabitsWidget(): Promise<void> {
  if (!isNative) return;
  try {
    /* A disabled plugin still gets a write, and it has to. Leaving the last snapshot in place would
       leave a widget on the home screen cheerfully showing habits from an account that has signed
       out, or a plugin that was switched off — stale in the one way that looks like a bug rather
       than like an empty state. An empty row list draws the empty message instead. */
    const snapshot = isPluginEnabled(PLUGIN_ID)
      ? await readSnapshot()
      : buildSnapshot(todayKey(), [], {}, new Map(), strings());

    await Preferences.set({ key: SNAPSHOT_KEY, value: JSON.stringify(snapshot) });
    await HabitsWidget.refresh();
  } catch (err) {
    captureError(err, { scope: 'habits.widget.refresh' });
  }
}

/** Every un-drained press, with the key it must be removed by once banked. */
async function readOps(): Promise<{ key: string; op: WidgetOp }[]> {
  const { keys } = await Preferences.keys();
  const pending: { key: string; op: WidgetOp }[] = [];

  for (const key of keys.filter((candidate) => candidate.startsWith(OP_PREFIX))) {
    const { value } = await Preferences.get({ key });
    if (!value) continue;
    try {
      const parsed = JSON.parse(value) as Partial<WidgetOp>;
      /* Parsed, not trusted — the same posture model.ts takes toward a row it did not write. A
         malformed op is dropped rather than retried: it came from this app's own provider, so it
         being unreadable means a version skew, and replaying it forever would wedge the queue. */
      if (
        typeof parsed.habitId === 'string' &&
        typeof parsed.dateKey === 'string' &&
        typeof parsed.delta === 'number' &&
        Number.isFinite(parsed.delta)
      ) {
        pending.push({ key, op: parsed as WidgetOp });
      } else {
        await Preferences.remove({ key });
      }
    } catch {
      await Preferences.remove({ key });
    }
  }
  return pending;
}

/**
 * Bank every press made on the widget since the app was last open.
 *
 * Grouped by day and written once per day rather than once per press: `putPluginRecord` enqueues a
 * sync and triggers a notification reconcile, and running down a widget checklist while the app was
 * closed must not become five of those. The same coalescing `WRITE_DEBOUNCE_MS` does for the card,
 * arrived at from the other side.
 *
 * Returns whether anything was applied, so the caller knows whether a refresh is owed.
 */
export async function drainWidgetOps(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const pending = await readOps();
    if (!pending.length) return false;

    const byDate = new Map<string, { key: string; op: WidgetOp }[]>();
    for (const entry of pending) {
      const bucket = byDate.get(entry.op.dateKey);
      if (bucket) bucket.push(entry);
      else byDate.set(entry.op.dateKey, [entry]);
    }

    /* The definitions, read once for the whole drain, purely to find each rating's ceiling.
       A press arrives as "+1", and for a mood or a scale that is a request rather than an answer:
       the bounds may have been edited since the snapshot the press was made against was written, so
       the provider's own clamp cannot be the last word. Everything else has no ceiling — exceeding
       a goal is the good outcome — which is why this is the only reason to load them at all. */
    const habits = new Map(
      (await getUndatedRecords(PLUGIN_ID)).flatMap((row) => {
        const habit = parseHabit(row);
        return habit ? [[habit.id, habit] as const] : [];
      }),
    );

    for (const [dateKey, entries] of byDate) {
      /* Re-read at the moment of applying rather than trusting the snapshot the presses were made
         against — that snapshot is exactly what may have gone stale. See the note on deltas. */
      const record = await getDayRecord(PLUGIN_ID, dateKey);
      const values = { ...parseValues(record) };

      for (const { op } of entries) {
        // Clamped at zero: absence *is* zero in this model (`valueData` strips it), so a −5 on a
        // habit already at 0 has to be a no-op rather than a negative the day card would have to
        // render.
        let next = Math.max(0, (values[op.habitId] ?? 0) + op.delta);

        const habit = habits.get(op.habitId);
        if (habit && (habit.type === 'scale' || habit.type === 'mood')) {
          // A rating has hard ends, and a 6 on a five-face mood is a value nothing downstream can
          // render — not the day card, not the grid, not the export. Clamped rather than dropped,
          // for the reason ScaleControl clamps a typed-in number: pressing past the top plainly
          // means "the top". `next > 0` guards the cleared state, which is not on the scale at all.
          const { min, max } = scaleBounds(habit, dateKey);
          if (next > 0) next = Math.min(max, Math.max(min, next));
        }

        values[op.habitId] = next;
      }

      await putPluginRecord(PLUGIN_ID, 'record', dateKey, valueData(values));
      // Only after the write lands. A crash before this replays the presses, which is the right
      // way round: a delta applied twice is visible and fixable, one dropped silently is not.
      for (const { key } of entries) await Preferences.remove({ key });
    }
    return true;
  } catch (err) {
    captureError(err, { scope: 'habits.widget.drain' });
    return false;
  }
}

/**
 * Throw away every un-drained press without applying it.
 *
 * For the two states in which a press has nowhere legitimate to land: the plugin has been switched
 * off, or the session has ended. Both leave presses in the file that were made against a diary this
 * device is no longer holding, and banking them would be actively wrong — after a sign-out
 * `clearLocalData()` has already wiped Dexie, so a drain would not *restore* the old account's day,
 * it would mint a fresh row for it and hand it to the outbox, where the next account to sign in on
 * this device would sync it up as their own.
 */
async function discardWidgetOps(): Promise<void> {
  const { keys } = await Preferences.keys();
  for (const key of keys.filter((candidate) => candidate.startsWith(OP_PREFIX))) {
    await Preferences.remove({ key });
  }
}

/**
 * Bank anything the widget recorded, then restate the result — the whole cycle, in the order it has
 * to happen in.
 *
 * This is what every lifecycle hook calls, and the order is load-bearing in both branches.
 *
 * Draining before refreshing, because refreshing first would push a snapshot that does not yet
 * include the presses about to be banked, and the widget would visibly flick back to the old number
 * for as long as the write took.
 *
 * Draining *only when the plugin is on*, because the alternative is a data leak rather than a
 * cosmetic one — see `discardWidgetOps`. This is the single guard protecting that, so it is checked
 * here rather than inside the drain, where a future caller could bypass it.
 */
export async function syncHabitsWidget(): Promise<void> {
  if (!isNative) return;
  if (isPluginEnabled(PLUGIN_ID)) {
    await drainWidgetOps();
    await clearStaleTimers();
  } else {
    await discardWidgetOps().catch((err) => captureError(err, { scope: 'habits.widget.discard' }));
  }
  await refreshHabitsWidget();
}

/**
 * Forget any stopwatch left running on a day that has ended.
 *
 * Discarded rather than banked, which is the answer `useStopwatch` has always given implicitly: it
 * keys timers by day, so yesterday's key is simply never read again. Banking would be worse than
 * losing it — a timer started at nine in the evening and forgotten would post eleven hours against a
 * habit, and a number nobody can explain is harder to undo than a session nobody recorded.
 *
 * Without this the keys would also accumulate, one per habit ever timed.
 */
async function clearStaleTimers(): Promise<void> {
  try {
    const today = todayKey();
    for (const [habitId, timer] of await readTimers()) {
      if (timer.dateKey !== today) await writeTimer(habitId, timer.dateKey, 0);
    }
  } catch (err) {
    captureError(err, { scope: 'habits.widget.timers' });
  }
}
