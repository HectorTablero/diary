package es.tablerus.diary;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.Map;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The file the web app and the widget both open.
 *
 * `@capacitor/preferences` stores everything as plain strings in one SharedPreferences file, named
 * "CapacitorStorage" (see Preferences.java in the plugin: `getSharedPreferences(group, MODE_PRIVATE)`
 * with the group defaulting to that name, and capacitor.config.ts does not override it). That single
 * fact is what makes this feature cheap: `Preferences.set` on the JS side and `getString` here are
 * reading and writing the same bytes, with no bridge, no plugin and no third-party package between
 * them.
 *
 * Both directions are described in web/src/plugins/habits/widgetBridge.ts. The short version:
 * one key holds the snapshot the widget draws, and every press writes its own key so that two
 * processes appending at once cannot lose each other's writes.
 */
final class HabitsWidgetStore {

    /** Must match PreferencesConfiguration.DEFAULTS.group in @capacitor/preferences. */
    private static final String PREFS = "CapacitorStorage";

    /** Must match SNAPSHOT_KEY in widgetBridge.ts. */
    private static final String SNAPSHOT_KEY = "habits.widget";

    /** Must match OP_PREFIX in widgetBridge.ts. */
    private static final String OP_PREFIX = "habits.widget.op.";

    /**
     * Must match WIDGET_SNAPSHOT_VERSION in widgetSnapshot.ts.
     *
     * The two are a matched pair and there is no test that can catch them drifting — one lives in
     * TypeScript and the other in Java, with a JSON blob and a process boundary in between. Bumping
     * the writer without bumping the reader makes every snapshot unreadable, and the symptom is not
     * an error anywhere: the widget quietly falls back to "Open Diary to set this up" forever,
     * because an unrecognised version is deliberately treated as *absent* rather than parsed
     * optimistically. Change one, change the other, in the same commit.
     *
     * 4 added `streakBefore`; 3 added `timerStartedAt`; 2 added `min`/`max` and split `ratio` into
     * `scale` and `mood`.
     */
    private static final int SUPPORTED_VERSION = 4;

    private HabitsWidgetStore() {}

    private static SharedPreferences prefs(final Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * The snapshot to draw, or null when there isn't a usable one.
     *
     * Null covers every way this can legitimately be empty — the app has never run, the user signed
     * out, the plugin is disabled, the stored JSON is from a build that wrote a different shape —
     * because the widget's answer to all of them is the same: draw the empty state. A version it
     * does not recognise is deliberately treated as absent rather than parsed optimistically: an APK
     * can be older than the web bundle running inside it, since the web layer updates over the air
     * (lib/liveUpdate.ts) while this class only changes when a new APK is installed.
     */
    static JSONObject readSnapshot(final Context context) {
        final String raw = prefs(context).getString(SNAPSHOT_KEY, null);
        if (raw == null) {
            return null;
        }
        try {
            final JSONObject snapshot = new JSONObject(raw);
            return snapshot.optInt("v") == SUPPORTED_VERSION ? snapshot : null;
        } catch (JSONException malformed) {
            return null;
        }
    }

    /**
     * Record a press, to be banked the next time the app runs.
     *
     * A delta, never a total — the snapshot this press was made against may be older than what is
     * in Dexie, and asserting a total computed from a stale base is how a change made on another
     * device gets silently undone. See the note on deltas in widgetBridge.ts.
     *
     * Its own key, for the same reason: the app may be draining this file at the exact moment a
     * press lands, and a shared JSON array would make that a read-modify-write from two processes
     * with no lock between them. A key nobody else touches cannot be clobbered.
     *
     * `commit` rather than `apply` because this runs in a broadcast receiver: `apply` writes on a
     * background thread, and the process is eligible to be killed as soon as onReceive returns.
     */
    static void appendOp(final Context context, final String habitId, final String dateKey, final int delta) {
        final JSONObject op = new JSONObject();
        try {
            op.put("habitId", habitId);
            op.put("dateKey", dateKey);
            op.put("delta", delta);
        } catch (JSONException impossible) {
            // Only thrown for a null key or a non-finite double, neither of which can occur here.
            return;
        }
        prefs(context).edit().putString(OP_PREFIX + UUID.randomUUID(), op.toString()).commit();
    }

    /** Must match TIMER_PREFIX in widgetBridge.ts. */
    private static final String TIMER_PREFIX = "habits.widget.timer.";

    /**
     * When this habit's stopwatch was started, in epoch milliseconds, or 0 if it isn't running.
     *
     * The one piece of state both processes write. A session started on the home screen has to be
     * pausable in the app and the other way round, which is why it lives here rather than in the
     * localStorage `useStopwatch` reads synchronously — the widget cannot reach that at all, and a
     * timer one side could not see would have both banking the same minutes.
     *
     * Only sessions belonging to `dateKey` count. A timer left running past midnight is not today's,
     * exactly as `useStopwatch` keys them by day.
     */
    static long readTimer(final Context context, final String habitId, final String dateKey) {
        final String raw = prefs(context).getString(TIMER_PREFIX + habitId, null);
        if (raw == null) {
            return 0L;
        }
        try {
            final JSONObject timer = new JSONObject(raw);
            return dateKey.equals(timer.optString("dateKey")) ? timer.optLong("startedAt") : 0L;
        } catch (JSONException malformed) {
            return 0L;
        }
    }

    /** Start this habit's stopwatch, or clear it with a `startedAt` of 0. */
    static void writeTimer(
        final Context context,
        final String habitId,
        final String dateKey,
        final long startedAt
    ) {
        final SharedPreferences.Editor editor = prefs(context).edit();
        if (startedAt <= 0L) {
            editor.remove(TIMER_PREFIX + habitId);
        } else {
            final JSONObject timer = new JSONObject();
            try {
                timer.put("dateKey", dateKey);
                timer.put("startedAt", startedAt);
            } catch (JSONException impossible) {
                return;
            }
            editor.putString(TIMER_PREFIX + habitId, timer.toString());
        }
        // `commit`, not `apply`: this runs in a broadcast receiver, and the process may be killed
        // as soon as onReceive returns.
        editor.commit();
    }

    /**
     * The presses this device has made but not yet banked, summed per habit.
     *
     * The widget is drawn from the snapshot *plus* this: a press has to move the number on screen
     * immediately, and the app that would fold it into the snapshot may not run for hours. It is the
     * same split the day card draws between committed and pending progress — what is banked, and
     * what is counted but not yet written.
     *
     * Only ops filed against `dateKey` count, so yesterday's un-drained presses cannot leak into
     * today's reading.
     */
    static Map<String, Integer> pendingDeltas(final Context context, final String dateKey) {
        final java.util.HashMap<String, Integer> totals = new java.util.HashMap<>();
        for (Map.Entry<String, ?> entry : prefs(context).getAll().entrySet()) {
            if (!entry.getKey().startsWith(OP_PREFIX) || !(entry.getValue() instanceof String)) {
                continue;
            }
            try {
                final JSONObject op = new JSONObject((String) entry.getValue());
                if (!dateKey.equals(op.optString("dateKey"))) {
                    continue;
                }
                final String habitId = op.optString("habitId");
                totals.put(habitId, totals.getOrDefault(habitId, 0) + op.optInt("delta"));
            } catch (JSONException malformed) {
                // Left in place for the app to notice and discard — this is a render path, and
                // deleting data from it would be the wrong place to do it.
            }
        }
        return totals;
    }
}
