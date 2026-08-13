package es.tablerus.diary;

import android.content.Context;
import android.content.Intent;
import android.text.TextUtils;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Map;
import org.json.JSONObject;

/**
 * One habit, drawn.
 *
 * Its own class because it is the only part of the widget both halves need: the factory builds rows
 * for the list, and the provider needs the same met/value arithmetic for the header counter. Having
 * one place decide what a row *is* is what stops "3/5" disagreeing with the five rows under it.
 *
 * ## The two rules that cross from TypeScript
 *
 * Everything about a habit is resolved before it gets here — which name, which goal, which bounds
 * were in force on the day — so this file has no idea what a habit kind is. Two rules could not be
 * pre-resolved, because a press has to redraw the row before the app has run, and both are stated
 * here in full:
 *
 *   met       `target > 0 ? value >= target : value > 0`, one line, for every format
 *   duration  hours/minutes/seconds, mirroring `formatDuration` in model.ts
 *
 * ## Clicks are fill-in intents, not PendingIntents
 *
 * Rows live in a collection, and a collection item may not carry its own PendingIntent. Each
 * pressable view contributes only its extras; the provider's template supplies the rest, and the
 * two are merged at tap time. See `HabitsWidgetProvider.template`.
 */
final class HabitsWidgetRow {

    /** Below this a streak is just "you did it today", which the row already shows. Matches
        STREAK_MIN in HabitControls.tsx. */
    static final int STREAK_MIN = 2;

    private HabitsWidgetRow() {}

    /** The value a row currently reads, banked plus not-yet-banked. Also what the header counts. */
    static int valueOf(final JSONObject row, final Map<String, Integer> pending) {
        final Integer delta = pending.get(row.optString("id"));
        /* A press has to move the number now, and the app that folds it into the snapshot may not
           run for hours — the same committed/pending split the day card draws while a stopwatch is
           running. Clamped at zero to match the drain, which stores absence rather than a negative. */
        return Math.max(0, row.optInt("raw") + (delta == null ? 0 : delta));
    }

    /** Whether a row counts as met. The rule, in full — see the note on this class. */
    static boolean isMet(final JSONObject row, final int value) {
        final int target = row.optInt("target");
        return target > 0 ? value >= target : value > 0;
    }

    /**
     * The streak to draw, given whatever this process currently knows `met` to be.
     *
     * `row.streak` is only ever the answer as of when the snapshot was written — a press made on the
     * widget itself changes `met` without a new snapshot to go with it, since the app is not running
     * to write one. `streakBefore` does not have that problem: it is the run of met days *not*
     * counting today, so it stays correct across a press, and today's own contribution is exactly the
     * one bit `isMet` already recomputes live for the rest of the row. Mirrors `currentStreak` in
     * streaks.ts, restated as the one line that implies.
     */
    static int streakFor(final JSONObject row, final boolean met) {
        return row.optInt("streakBefore") + (met ? 1 : 0);
    }

    static RemoteViews build(
        final Context context,
        final JSONObject row,
        final JSONObject strings,
        final String dateKey,
        final Map<String, Integer> pending,
        final boolean moodInline
    ) {
        final String habitId = row.optString("id");
        final String format = row.optString("format", "count");
        final boolean isMood = "mood".equals(format);
        final int step = row.optInt("step");
        final int value = valueOf(row, pending);
        final boolean met = isMet(row, value);

        /* A layout per control. Mood gets two of its own: five 30dp targets and a label do not share
           a line on a narrow widget, and the alternative to wrapping is five targets too small to
           hit — but on a wide one, wrapping wastes a line for nothing. The factory decides which,
           from the width the launcher actually gave this widget. */
        final int layout = isMood
            ? (moodInline ? R.layout.widget_habits_row_mood_inline : R.layout.widget_habits_row_mood)
            : R.layout.widget_habits_row;
        final RemoteViews item = new RemoteViews(context.getPackageName(), layout);

        /* The name, in one of two prepared TextViews.
         *
         * Driven by `value > 0`, not by `met`, which is HabitRow's own rule: `const done =
         * live.total > 0`. The difference is the whole point of the signal — twelve of a hundred
         * push-ups is *progress*, and the name brightening is how the card says "you have started
         * this" separately from the bar saying how far. Keyed to `met` it stayed grey until the goal
         * was reached, which is the one reading that makes a part-done habit look untouched.
         *
         * A swap rather than a `setTextColor`, because a resolved colour baked into RemoteViews
         * survives a theme change while every XML-referenced colour around it flips. */
        final boolean started = value > 0;
        item.setViewVisibility(R.id.row_label_done, started ? View.VISIBLE : View.GONE);
        item.setViewVisibility(R.id.row_label_todo, started ? View.GONE : View.VISIBLE);
        item.setTextViewText(
            started ? R.id.row_label_done : R.id.row_label_todo, row.optString("label"));

        final int streak = streakFor(row, met);
        if (streak >= STREAK_MIN) {
            item.setViewVisibility(R.id.row_streak_done, met ? View.VISIBLE : View.GONE);
            item.setViewVisibility(R.id.row_streak_todo, met ? View.GONE : View.VISIBLE);
            item.setTextViewText(
                met ? R.id.row_streak_count_done : R.id.row_streak_count_todo, String.valueOf(streak));
        } else {
            item.setViewVisibility(R.id.row_streak_done, View.GONE);
            item.setViewVisibility(R.id.row_streak_todo, View.GONE);
        }

        if (isMood) {
            /* No "4/5" beside the faces. The chosen face already says which level it is, and more
               precisely than a fraction does — the number was restating the control next to it. */
            moodFaces(item, habitId, dateKey, value);
            return item;
        }

        /* A goal bar, for the two kinds that can fall short of one. Not for a yes/no: its `target`
           is 1 purely so the met rule can be a single line, and a bar that is only ever empty or
           full is the pill beside it drawn twice. */
        final boolean hasGoal = row.optInt("target") > 0
            && ("count".equals(format) || "duration".equals(format));
        if (hasGoal) {
            item.setViewVisibility(R.id.row_progress, View.VISIBLE);
            // Capped: exceeding a goal is the good outcome, but a bar cannot show more than full.
            item.setProgressBar(
                R.id.row_progress, 100, Math.min(100, value * 100 / row.optInt("target")), false);
        } else {
            item.setViewVisibility(R.id.row_progress, View.GONE);
        }

        if ("binary".equals(format)) {
            final int pill = met ? R.id.row_pill_on : R.id.row_pill_off;
            item.setViewVisibility(R.id.row_stepper, View.GONE);
            item.setViewVisibility(pill, View.VISIBLE);
            item.setViewVisibility(met ? R.id.row_pill_off : R.id.row_pill_on, View.GONE);
            item.setTextViewText(
                met ? R.id.row_pill_label_on : R.id.row_pill_label_off,
                optString(strings, "markDone", row.optString("value"))
            );
            // The delta is decided here, at draw time, from the value on screen — which is why the
            // row is redrawn immediately after a press rather than only when the app next runs.
            item.setOnClickFillInIntent(pill, fillIn(habitId, dateKey, met ? -1 : 1));
        } else {
            final int min = row.optInt("min");
            final int max = row.optInt("max");
            final boolean bounded = max > min;

            item.setViewVisibility(R.id.row_stepper, View.VISIBLE);
            item.setViewVisibility(R.id.row_pill_on, View.GONE);
            item.setViewVisibility(R.id.row_pill_off, View.GONE);

            /* Read from the store, not from `row.timerStartedAt`.
             *
             * The snapshot carries a copy so that its payload is a complete description of what the
             * widget shows, but it is only ever the app's record of the moment it was written. The
             * store is what both processes write — a session started here a second ago is in it and
             * cannot be in the snapshot yet — so it is the one that decides. */
            final long startedAt = "duration".equals(format)
                ? HabitsWidgetStore.readTimer(context, habitId, dateKey)
                : 0L;
            final boolean running = startedAt > 0L;
            timer(item, habitId, dateKey, format, startedAt);

            /* Always the banked total, and static even while a session runs.
             *
             * The live clock is the pinned strip's job — a Chronometer cannot tick inside a
             * collection item, which is what made the in-row one only move on pause or resize (see
             * widget_habits.xml). Showing what is *banked* here and what is banked plus running up
             * there is the same committed/pending split the day card draws, so the two numbers
             * differing by the current session is the truth rather than a discrepancy. */
            item.setViewVisibility(R.id.row_value, View.VISIBLE);
            item.setTextViewText(R.id.row_value, display(row, strings, format, value));

            /* Refused at the ends rather than clamped there. A scale's bounds come from the
               snapshot; the drain clamps again on arrival, because they may have been edited since
               this snapshot was written. A null fill-in intent is what makes a view unclickable.

               Both steppers go dead while a session runs, matching TimeControl: editing the number
               a clock is currently writing to is the one edit that cannot be reconciled. */
            final boolean canDecrease = !running && value > 0 && (!bounded || value > min);
            final boolean canIncrease = !running && (!bounded || value < max);
            item.setOnClickFillInIntent(
                R.id.row_minus, canDecrease ? fillIn(habitId, dateKey, -step) : null);
            item.setOnClickFillInIntent(
                R.id.row_plus, canIncrease ? fillIn(habitId, dateKey, step) : null);
        }

        return item;
    }

    /**
     * The stopwatch, for duration habits only.
     *
     * Only the button: the ticking readout lives in the pinned strip above the list, because a
     * Chronometer inside a collection item does not tick. See widget_habits.xml.
     *
     * ## Why a toggle carries no delta
     *
     * Starting and pausing are not value edits, so their fill-in intent carries the timer flag
     * instead. The provider decides what a press means from the stored state at the moment it
     * lands — pausing computes the elapsed seconds *then*, rather than trusting a number the widget
     * calculated when it last painted, which on a row that has been sitting on a home screen for an
     * hour would be an hour out of date.
     */
    private static void timer(
        final RemoteViews item,
        final String habitId,
        final String dateKey,
        final String format,
        final long startedAt
    ) {
        if (!"duration".equals(format)) {
            item.setViewVisibility(R.id.row_timer_play, View.GONE);
            item.setViewVisibility(R.id.row_timer_pause, View.GONE);
            return;
        }

        final boolean running = startedAt > 0L;
        item.setViewVisibility(R.id.row_timer_play, running ? View.GONE : View.VISIBLE);
        item.setViewVisibility(R.id.row_timer_pause, running ? View.VISIBLE : View.GONE);
        item.setOnClickFillInIntent(
            running ? R.id.row_timer_pause : R.id.row_timer_play, timerFillIn(habitId, dateKey));
    }

    /** A timer toggle. No delta: what the press means is decided from stored state when it lands. */
    private static Intent timerFillIn(final String habitId, final String dateKey) {
        return new Intent()
            .setData(android.net.Uri.parse("diary-habit-timer://" + habitId + "/" + dateKey))
            .putExtra(HabitsWidgetProvider.EXTRA_HABIT_ID, habitId)
            .putExtra(HabitsWidgetProvider.EXTRA_DATE_KEY, dateKey)
            .putExtra(HabitsWidgetProvider.EXTRA_TIMER, true);
    }

    /**
     * The five faces, worst to best — MoodControl, on a home screen.
     *
     * One `setImageViewResource` per face carries both halves of its state: the chosen one is a
     * primary-tinted glyph on `bg-primary/15`, the rest are muted with no circle, and both live in
     * the drawable rather than being assembled here. That is what keeps them resolving in the
     * launcher's process, and therefore correct in dark mode.
     *
     * Tapping the chosen face again clears it, which is the only way back to "not recorded" without
     * a sixth control meaning nothing — exactly the day card's rule. The delta is the difference
     * between where the value is and where the tap would put it, because a press records what it
     * did rather than what it thinks the answer is.
     */
    private static void moodFaces(
        final RemoteViews item,
        final String habitId,
        final String dateKey,
        final int value
    ) {
        final int[] views = {
            R.id.row_face_1, R.id.row_face_2, R.id.row_face_3, R.id.row_face_4, R.id.row_face_5
        };
        final int[] chosen = {
            R.drawable.widget_face_1_on, R.drawable.widget_face_2_on, R.drawable.widget_face_3_on,
            R.drawable.widget_face_4_on, R.drawable.widget_face_5_on
        };
        final int[] plain = {
            R.drawable.widget_face_1_off, R.drawable.widget_face_2_off, R.drawable.widget_face_3_off,
            R.drawable.widget_face_4_off, R.drawable.widget_face_5_off
        };

        for (int index = 0; index < views.length; index++) {
            final int level = index + 1;
            final boolean picked = value == level;
            item.setImageViewResource(views[index], picked ? chosen[index] : plain[index]);
            item.setOnClickFillInIntent(views[index], fillIn(habitId, dateKey, (picked ? 0 : level) - value));
        }
    }

    /**
     * A press, as the extras a collection item is allowed to contribute.
     *
     * The `Uri` matters as much as the extras and is easy to leave out. Fill-in intents are merged
     * into the template by `Intent.fillIn`, and two items whose intents are `filterEquals` collapse
     * onto one — so without a distinct data URI per button, every row's `+` would share whichever
     * was created last. Extras alone do not distinguish them.
     */
    private static Intent fillIn(final String habitId, final String dateKey, final int delta) {
        return new Intent()
            .setData(android.net.Uri.parse("diary-habit://" + habitId + "/" + dateKey + "/" + delta))
            .putExtra(HabitsWidgetProvider.EXTRA_HABIT_ID, habitId)
            .putExtra(HabitsWidgetProvider.EXTRA_DATE_KEY, dateKey)
            .putExtra(HabitsWidgetProvider.EXTRA_DELTA, delta);
    }

    /** What the value reads as, given a number the widget may have just changed itself. */
    private static String display(
        final JSONObject row,
        final JSONObject strings,
        final String format,
        final int value
    ) {
        switch (format) {
            case "binary":
                return optString(strings, value > 0 ? "done" : "notDone", value > 0 ? "✓" : "—");
            case "duration":
                return duration(value, row.optBoolean("showSeconds"));
            case "scale":
                /* "4/5", or an em dash while nothing is recorded. A track parked at its lowest and
                   one never answered are different facts about a day, and they would otherwise look
                   identical. (Mood shows no number at all — the chosen face is the answer.) */
                return value > 0 ? value + "/" + row.optInt("max") : "—";
            default:
                final String unit = row.optString("unit");
                return TextUtils.isEmpty(unit) ? String.valueOf(value) : value + " " + unit;
        }
    }

    /**
     * Seconds as hours, minutes and seconds. Mirrors `formatDuration` in model.ts, including its one
     * subtlety: under a minute always shows seconds regardless of the goal, because "0m" for forty
     * seconds of work reads as nothing having been recorded at all.
     */
    private static String duration(final int totalSeconds, final boolean withSeconds) {
        final int seconds = Math.max(0, totalSeconds);
        final int hours = seconds / 3600;
        final int minutes = (seconds % 3600) / 60;
        final int rest = seconds % 60;

        if (hours == 0 && minutes == 0) {
            return rest + "s";
        }
        if (hours == 0) {
            return withSeconds ? minutes + "m " + rest + "s" : minutes + "m";
        }
        return withSeconds ? hours + "h " + minutes + "m " + rest + "s" : hours + "h " + minutes + "m";
    }

    static String optString(final JSONObject source, final String key, final String fallback) {
        if (source == null) {
            return fallback;
        }
        final String value = source.optString(key, fallback);
        return TextUtils.isEmpty(value) ? fallback : value;
    }
}
