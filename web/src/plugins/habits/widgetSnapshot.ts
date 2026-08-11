import {
  configAt,
  formatDuration,
  formatHabitValue,
  metTarget,
  scaleBounds,
  showsSeconds,
  type Habit,
} from './model';

/**
 * What the Android home-screen widget is told, and nothing more.
 *
 * ## Why this is a presentation payload rather than the habits themselves
 *
 * The widget is rendered by `HabitsWidgetProvider.java`, in a process with no WebView, no Dexie and
 * no i18n. Whatever it needs has to be handed to it as plain JSON through SharedPreferences. The
 * question is *what* — and the answer decides how much Java this feature costs forever.
 *
 * Ship the domain (habits, kinds, targets, revisions) and the provider has to grow a second
 * implementation of the plugin's rules: which goal was in force on this day, what a `mood` is, how
 * a `scale` reads, what counts as met. Every rule then exists twice, in two languages, and the two
 * copies drift the first time a kind is added — silently, because nothing type-checks across that
 * boundary.
 *
 * So the model stays here and only its *conclusions* cross. A row carries a label, a string to
 * display, a number behind it and a goal to fill toward. `HabitKind` never appears in Java; adding
 * a sixth kind is a change to `toRow` and to nothing native at all.
 *
 * ## The four formats, and why they are not the five kinds
 *
 * The widget still has to re-render a row *locally* after a `+` press — the app may not be running,
 * and a stepper that does nothing until you next open the app is not a stepper. That is the only
 * reason `format` exists: it is the smallest thing the provider needs to turn a number back into
 * text. Four display shapes cover the five kinds today and are the shapes any future kind will
 * reuse, because they are about typography rather than meaning:
 *
 *   count     a number, optionally with a unit — "20", "20 reps"
 *   duration  hours/minutes/seconds — "1h 20m"
 *   binary    a pill that reads `strings.markDone`, filled once it is
 *   scale     a reading against a fixed top — "4/5" — stepped between its bounds
 *   mood      the same reading, chosen from five faces
 *
 * The split between `scale` and `mood` is the one place a "format" tracks a kind exactly, and it is
 * deliberate rather than a leak: they display identically and are *operated* differently, which is
 * the distinction this field exists to carry. The day card makes the same split for the same reason.
 */

/**
 * Bumped when the shape changes in a way `HabitsWidgetStore.java` must notice.
 *
 * 2 added `min`/`max` and split `ratio` into `scale` and `mood`, so that every kind has a control
 * rather than only the countable ones. 3 added `timerStartedAt`, so a running stopwatch is visible
 * to the widget. 4 added `streakBefore`, so a streak reached by a press made on the widget itself
 * shows without the app having run — see the note on `streakBefore` below. An older APK reading a
 * newer snapshot treats it as absent and draws its empty state, which is the right failure: the web
 * layer updates over the air while the provider only changes when a new APK is installed, so this
 * pairing is genuinely allowed to skew.
 */
export const WIDGET_SNAPSHOT_VERSION = 4;

export type WidgetRowFormat = 'count' | 'duration' | 'binary' | 'scale' | 'mood';

export interface WidgetRow {
  /** The habit's row id — what a `+` press names in the op it writes back. */
  id: string;
  label: string;
  /** How the value reads right now. The provider recomputes this after a local press. */
  value: string;
  format: WidgetRowFormat;
  /** The number behind `value`, in the habit's stored units (seconds, for a duration). */
  raw: number;
  /** Appended after a `count`'s number. Empty when the habit has no unit. */
  unit: string;
  /**
   * The goal, in `raw`'s units — 0 when there is none.
   *
   * Doing double duty, deliberately. It is the denominator of the progress bar *and* the whole of
   * the met rule: `target > 0 ? raw >= target : raw > 0`. One line in Java, and it is exactly what
   * `metTarget` decides here, so the widget cannot disagree with the day card about whether a habit
   * was done. Binary rows therefore ship `target: 1` rather than 0 — a ticked box is a goal reached.
   */
  target: number;
  /** What one press of − or + is worth. 0 hides the steppers, which is how a row is read-only. */
  step: number;
  /**
   * A rating's bounds — both 0 for everything else.
   *
   * Present so the provider can clamp a press without knowing what a scale is: a mood stepped past
   * five, or a 1–10 scale stepped to 11, would be a value the day card could not render and the
   * export could not explain. The drain clamps again on the way in (see `widgetBridge`), because a
   * press is only a request and the bounds may have been edited since the snapshot was written.
   */
  min: number;
  max: number;
  /**
   * Epoch milliseconds a stopwatch was started at, or 0 when none is running.
   *
   * Duration habits only. The widget draws this with a `Chronometer`, which counts on its own in the
   * launcher's process — so a running timer ticks on the home screen with this app closed and no
   * broadcasts at all. Only the start instant crosses, never an elapsed count, for the reason
   * `useStopwatch` persists an instant rather than accumulating in memory: a number derived from the
   * clock cannot drift, and nothing is lost if either side is killed mid-session.
   */
  timerStartedAt: number;
  /**
   * Whether a `duration` shows its seconds — `showsSeconds` for this habit, resolved here.
   *
   * Passed rather than re-derived because the rule is about the *goal* ("ten minutes of stretching
   * is measured in seconds, two hours of study is not"), and the goal is a thing the provider would
   * otherwise have to reason about historically. See `SECONDS_SHOWN_BELOW_TARGET` in model.ts.
   */
  showSeconds: boolean;
  met: boolean;
  /**
   * The streak as of when this snapshot was written — `streakBefore + (met ? 1 : 0)` at that moment.
   *
   * Kept for anyone reading the JSON directly (a debug dump, a future export); the provider does not
   * read it, because it goes stale the instant a press on the widget changes `met` — see
   * `streakBefore`.
   */
  streak: number;
  /**
   * The run of met days *not counting* `dateKey` — `streakBefore` from streaks.ts, restated for a
   * day the widget already knows the answer for.
   *
   * This is what the provider actually draws from, and the split exists for the reason
   * `streakBefore` exists there: it does not move when a press changes today's own answer. `met` is
   * already recomputed in Java after every press (`HabitsWidgetRow.isMet`, run against the banked
   * total plus whatever has not been drained yet) — pairing it with a number that cannot go stale
   * mid-session is what lets a streak reached from the home screen show immediately, rather than
   * waiting for the app to next write a snapshot. Java restates the one line this implies,
   * `streakBefore + (met ? 1 : 0)`, wherever a streak is drawn.
   */
  streakBefore: number;
}

/**
 * Every string the widget draws that is not a habit's own name.
 *
 * Here rather than in `strings.xml` because the app's language is a preference inside the WebView —
 * `res/values-es/` would follow the *system* locale and cheerfully disagree with the app on a phone
 * set to English by someone who reads their diary in Spanish. Shipping them makes the widget's
 * language the app's language by construction, and costs one JSON field.
 */
export interface WidgetStrings {
  title: string;
  done: string;
  notDone: string;
  /** The word on a yes/no habit's pill — the day card's own button label, reused verbatim so the
      two surfaces ask the same question in the same words. */
  markDone: string;
  /** No habits set up yet. */
  empty: string;
  /** Habits exist but this day predates or postdates all of them. */
  nothingToday: string;
}

export interface WidgetSnapshot {
  v: number;
  /** The day these rows describe. The provider compares it against the device's own date and
      refuses to present a stale day as today — see `HabitsWidgetProvider.isStale`. */
  dateKey: string;
  rows: WidgetRow[];
  strings: WidgetStrings;
  /** Epoch ms. Only for debugging a widget that looks frozen. */
  updatedAt: number;
}

/** A duration's editable step: a minute for something short, five for anything longer. Mirrors
    `TimeControl`'s choice, so the widget and the day card move a timer by the same amount. */
const durationStep = (target: number | undefined): number =>
  target && target < 15 * 60 ? 60 : 5 * 60;

/** A count's step: the size of the thing being recorded. Mirrors `HabitControl`'s numeric branch. */
const countStep = (target: number | undefined): number => (target && target >= 50 ? 5 : 1);

/**
 * One habit, as the widget will draw it.
 *
 * Everything historical — which name, which goal, which bounds were in force on `dateKey` — is
 * resolved through `configAt` here, exactly as the day card resolves it. That is the whole reason
 * the provider can stay ignorant: by the time a row crosses into Java it is already a statement
 * about one specific day, not a habit that has to be interpreted against one.
 */
export function toRow(
  habit: Habit,
  value: number,
  dateKey: string,
  /** The run of met days before `dateKey` — see `streakBefore` on `WidgetRow`. */
  streakBefore: number,
  strings: WidgetStrings,
  /** Epoch ms this habit's stopwatch was started at, if one is running. Duration habits only. */
  timerStartedAt = 0,
): WidgetRow {
  const config = configAt(habit, dateKey);
  const met = metTarget(habit, value, dateKey);

  const base = {
    id: habit.id,
    label: config.name,
    raw: value,
    met,
    streak: streakBefore + (met ? 1 : 0),
    streakBefore,
    showSeconds: false,
    unit: '',
    timerStartedAt: 0,
    // Overridden only by the two rating kinds; zero everywhere else means "no bounds to clamp to".
    min: 0,
    max: 0,
  };

  if (habit.type === 'binary') {
    return {
      ...base,
      format: 'binary',
      value: value > 0 ? strings.done : strings.notDone,
      target: 1,
      // A tap toggles rather than steps, but the provider needs a non-zero step to know the row is
      // pressable at all; `binary` tells it the press is a toggle.
      step: 1,
    };
  }

  if (habit.type === 'time') {
    const showSeconds = showsSeconds(habit, dateKey);
    return {
      ...base,
      format: 'duration',
      value: formatDuration(value, showSeconds),
      showSeconds,
      timerStartedAt,
      target: config.target ?? 0,
      step: durationStep(config.target),
    };
  }

  if (habit.type === 'scale' || habit.type === 'mood') {
    const { min, max } = scaleBounds(habit, dateKey);
    return {
      ...base,
      /* Same reading, different control. A scale is stepped between its bounds — the widget's
         answer to a dragged track, which needs a gesture a home screen cannot offer. A mood is
         picked from the five faces the day card uses, because five discrete choices *is* the
         control, and stepping through them would turn one tap into up to five. */
      format: habit.type === 'mood' ? 'mood' : 'scale',
      value: value > 0 ? `${value}/${max}` : '—',
      // No goal to fall short of: recorded *is* the goal, so `raw > 0` decides met — see `target`.
      target: 0,
      min,
      max,
      // Mood's step is unused (a face is chosen, not stepped) but non-zero, because `step > 0` is
      // what marks a row as pressable at all.
      step: 1,
    };
  }

  return {
    ...base,
    format: 'count',
    value: formatHabitValue(habit, value, dateKey),
    unit: config.unit ?? '',
    target: config.target ?? 0,
    step: countStep(config.target),
  };
}

/** How many of a day's rows reached their goal — the numerator of the header's "3/5". */
export const metCount = (rows: readonly WidgetRow[]): number =>
  rows.filter((row) => row.met).length;

export function buildSnapshot(
  dateKey: string,
  habits: readonly Habit[],
  values: Record<string, number>,
  /** Each habit's `streakBefore` — the run of met days *not counting* `dateKey`. */
  streaksBefore: ReadonlyMap<string, number>,
  strings: WidgetStrings,
  /** Running stopwatches, by habit id. Absent for every habit that has none. */
  timers?: ReadonlyMap<string, number>,
): WidgetSnapshot {
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    dateKey,
    rows: habits.map((habit) =>
      toRow(
        habit,
        values[habit.id] ?? 0,
        dateKey,
        streaksBefore.get(habit.id) ?? 0,
        strings,
        timers?.get(habit.id) ?? 0,
      ),
    ),
    strings,
    updatedAt: Date.now(),
  };
}
