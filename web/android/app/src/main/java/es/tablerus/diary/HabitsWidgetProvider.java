package es.tablerus.diary;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The habits widget: a card, a header, and a scrolling list of habits.
 *
 * ## What this class deliberately does not know
 *
 * There is no such thing as a habit in here. No kinds, no targets-in-force-on-a-day, no archiving,
 * no streak arithmetic. It receives rows that are already finished statements about one particular
 * day and hands them to a list; `HabitsWidgetRow` draws them.
 *
 * That line is the maintenance argument for the whole feature. The plugin's rules live in
 * TypeScript, where they are tested; adding a sixth habit kind is a change to `toRow` in
 * widgetSnapshot.ts and to nothing native at all.
 *
 * ## Why the rows are a collection
 *
 * They used to be built here and appended with `addView`, which cannot scroll: the list was as tall
 * as it was, and a launcher given less room simply cropped it, squashing the last habit and slicing
 * through it. A `ListView` backed by `HabitsWidgetService` scrolls, at the cost of two things this
 * class now has to do carefully — install a *template* PendingIntent for the whole list (items may
 * not own one), and re-notify the factory whenever the data or the widget's size changes.
 *
 * ## Why plain RemoteViews at all
 *
 * Not Glance: its latest stable is 1.1.1 (October 2024, with 1.2.0 still unreleased), and it would
 * put the Kotlin and Compose compilers into a Gradle project that is otherwise entirely Java, for a
 * UI that is a list of rows. Not an SVG rasterised in the WebView either — a bitmap has no tap
 * targets, ignores the system font size, and cannot repaint from a process that isn't running,
 * which is exactly when a widget has to.
 */
public class HabitsWidgetProvider extends AppWidgetProvider {

    /** A ± press. Fired at this class through the list's template intent. */
    private static final String ACTION_OP = "es.tablerus.diary.habits.WIDGET_OP";

    /**
     * Deliberately does nothing. Its only job is to be somewhere for a tap to go.
     *
     * A view with no click handler does not swallow a touch — it passes it up the hierarchy, and a
     * lifted timer row sits directly in the widget's root rather than inside the list, so its taps
     * reached the ancestor that *does* have one and opened the app. The rows in the collection have
     * no such problem: an item whose views carry no fill-in intent simply absorbs the tap, which is
     * why they correctly do nothing.
     *
     * So the strip is given the same behaviour explicitly. `onReceive` returns immediately on this
     * action, without even the repaint every other branch ends with.
     */
    private static final String ACTION_NOOP = "es.tablerus.diary.habits.WIDGET_NOOP";

    static final String EXTRA_HABIT_ID = "habitId";
    static final String EXTRA_DATE_KEY = "dateKey";
    static final String EXTRA_DELTA = "delta";
    /**
     * Marks a press as a stopwatch toggle rather than a value edit.
     *
     * An extra rather than a second action, because it cannot be a second action: a collection's
     * fill-in intent can only supply fields the template left unset, and the template already has
     * one. Extras are merged, so this is what a row has to distinguish itself with.
     */
    static final String EXTRA_TIMER = "timer";

    /** `yyyy-MM-dd` in the device's own timezone — the same key `todayKey()` produces. */
    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    @Override
    public void onUpdate(final Context context, final AppWidgetManager manager, final int[] widgetIds) {
        for (int widgetId : widgetIds) {
            manager.updateAppWidget(widgetId, build(context, widgetId));
        }
    }

    /**
     * The widget was resized.
     *
     * Worth handling rather than ignoring: whether five mood faces fit beside their label is a
     * question about this widget's width, and the factory reads that width when it rebuilds. Without
     * this the layout would only catch up the next time something else happened to refresh it.
     */
    @Override
    public void onAppWidgetOptionsChanged(
        final Context context,
        final AppWidgetManager manager,
        final int appWidgetId,
        final Bundle newOptions
    ) {
        super.onAppWidgetOptionsChanged(context, manager, appWidgetId, newOptions);
        manager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_rows);
        manager.updateAppWidget(appWidgetId, build(context, appWidgetId));
    }

    /**
     * Everything that reaches this widget other than a scheduled update.
     *
     * `ACTION_DATE_CHANGED` is the one worth pointing at: the system broadcasts it at midnight, and
     * it is what stops the widget presenting yesterday's ticks as today's. It cannot *fix* the
     * reading — only the app can read Dexie — but it can notice, which is what the staleness check
     * in `build` does with it.
     */
    @Override
    public void onReceive(final Context context, final Intent intent) {
        super.onReceive(context, intent);
        if (intent == null) {
            return;
        }
        if (ACTION_NOOP.equals(intent.getAction())) {
            // A tap on a lifted row that was not on one of its buttons. Absorbed, and nothing more —
            // repainting here would make the whole widget flicker every time someone missed.
            return;
        }

        if (ACTION_OP.equals(intent.getAction())) {
            final String habitId = intent.getStringExtra(EXTRA_HABIT_ID);
            final String dateKey = intent.getStringExtra(EXTRA_DATE_KEY);
            final int delta = intent.getIntExtra(EXTRA_DELTA, 0);
            /* Refused rather than filed against today: the press was made against a snapshot that
               named a day, and if that day is no longer today then which day the person meant is
               genuinely unknown. The controls are already gone in that state — this is the guard
               for a template fired from a widget that had not repainted yet. */
            if (habitId != null && dateKey != null && dateKey.equals(today())) {
                if (intent.getBooleanExtra(EXTRA_TIMER, false)) {
                    toggleTimer(context, habitId, dateKey);
                } else if (delta != 0) {
                    HabitsWidgetStore.appendOp(context, habitId, dateKey, delta);
                }
            }
        }

        renderAll(context);
    }

    /**
     * Start this habit's stopwatch, or pause it and bank what it counted.
     *
     * The elapsed time is computed here, from the stored start instant, at the moment the press
     * lands — never from anything the widget calculated when it last painted, which on a row that
     * has sat on a home screen for an hour would be an hour stale. Banked as an ordinary delta op,
     * so a session recorded on the home screen reaches Dexie by exactly the path a `+` press does.
     *
     * Rounded down to whole seconds, and a session shorter than one second banks nothing but still
     * stops: pausing must always clear the timer, or a stray tap would leave a clock running that
     * the row no longer shows a pause button for.
     */
    private static void toggleTimer(final Context context, final String habitId, final String dateKey) {
        final long startedAt = HabitsWidgetStore.readTimer(context, habitId, dateKey);
        if (startedAt <= 0L) {
            HabitsWidgetStore.writeTimer(context, habitId, dateKey, System.currentTimeMillis());
            return;
        }
        final int seconds = (int) Math.max(0L, (System.currentTimeMillis() - startedAt) / 1000L);
        HabitsWidgetStore.writeTimer(context, habitId, dateKey, 0L);
        if (seconds > 0) {
            HabitsWidgetStore.appendOp(context, habitId, dateKey, seconds);
        }
    }

    /**
     * Redraw every placed instance, list included.
     *
     * Called by {@link HabitsWidgetPlugin} when the app writes a new snapshot, and by this class
     * after a press. Both halves are needed and they are not the same thing:
     * `notifyAppWidgetViewDataChanged` re-runs the factory (the rows), while `updateAppWidget`
     * redraws the frame around it (the header counter, the empty message).
     */
    static void renderAll(final Context context) {
        final AppWidgetManager manager = AppWidgetManager.getInstance(context);
        final int[] ids = manager.getAppWidgetIds(new ComponentName(context, HabitsWidgetProvider.class));
        if (ids == null || ids.length == 0) {
            return;
        }
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_rows);
        for (int widgetId : ids) {
            manager.updateAppWidget(widgetId, build(context, widgetId));
        }
    }

    private static RemoteViews build(final Context context, final int appWidgetId) {
        final RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_habits);
        final JSONObject snapshot = HabitsWidgetStore.readSnapshot(context);

        /* Tapping the card opens the app. Set before the early returns so it is true of the empty
           and stale states too — those are precisely the states someone taps to resolve. Deliberately
           on the header rather than the root: a root-level click would swallow taps meant for the
           list, and a widget whose ± buttons open the app instead of recording is worse than one
           that cannot be tapped at all. */
        final PendingIntent open = openApp(context, snapshot);
        views.setOnClickPendingIntent(R.id.widget_header, open);

        /* The list's adapter, and the single template every row's buttons fill in. A per-widget data
           URI is what stops two placed widgets sharing one adapter. */
        final Intent adapter = new Intent(context, HabitsWidgetService.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            .setData(Uri.parse("diary-habits://widget/" + appWidgetId));
        views.setRemoteAdapter(R.id.widget_rows, adapter);
        views.setPendingIntentTemplate(R.id.widget_rows, template(context));
        // Shown by the launcher whenever the adapter reports no items — see the factory.
        views.setEmptyView(R.id.widget_rows, R.id.widget_message);

        final JSONObject strings = snapshot == null ? null : snapshot.optJSONObject("strings");
        views.setTextViewText(
            R.id.widget_title,
            HabitsWidgetRow.optString(strings, "title", context.getString(R.string.widget_habits_title))
        );

        if (snapshot == null) {
            // No snapshot at all: the app has never run, or it is mid-install.
            return message(context, views, context.getString(R.string.widget_habits_loading));
        }

        final JSONArray rows = snapshot.optJSONArray("rows");
        if (!today().equals(snapshot.optString("dateKey"))) {
            /* Between midnight and the app's next run, the snapshot describes a day that has ended.
               Presenting it as today would be wrong, and guessing today's values from it would be
               wrong in a way that looks right — a habit recorded on another device would show as
               untouched. Background sync normally resolves this within the quarter hour. */
            return message(context, views, context.getString(R.string.widget_habits_stale));
        }
        if (rows == null || rows.length() == 0) {
            // The plugin is off, the account signed out, or every habit is retired. The web layer
            // chose which of those this is and shipped the sentence for it.
            return message(context, views, HabitsWidgetRow.optString(strings, "empty", ""));
        }

        /* The counter, computed from exactly what the rows will draw — same value arithmetic, same
           met rule, one implementation in HabitsWidgetRow. Counting it separately here is how "3/5"
           would come to disagree with the five rows underneath it. */
        final Map<String, Integer> pending =
            HabitsWidgetStore.pendingDeltas(context, snapshot.optString("dateKey"));
        int met = 0;
        for (int index = 0; index < rows.length(); index++) {
            final JSONObject row = rows.optJSONObject(index);
            if (row != null && HabitsWidgetRow.isMet(row, HabitsWidgetRow.valueOf(row, pending))) {
                met++;
            }
        }

        views.setViewVisibility(R.id.widget_counter, View.VISIBLE);
        views.setTextViewText(R.id.widget_counter, met + "/" + rows.length());
        /* Blanked, because the list can now be empty while the day is not. The factory lifts the
           running habit out of the collection, so a person timing their only habit leaves an empty
           adapter — and the launcher swaps in this view for it. Left holding the last sentence it
           was given, it would announce "no habits yet" directly beneath the habit that is running. */
        views.setTextViewText(R.id.widget_message, "");
        session(context, views, rows, snapshot.optString("dateKey"), pending);
        return views;
    }

    /**
     * Every running stopwatch, lifted out of the list and drawn above it.
     *
     * ## Why they are not in the rows they belong to
     *
     * Because a Chronometer inside a collection item does not tick. It keeps time by posting itself
     * a message each second while started, visible and shown; in a `ListView` backed by a
     * `RemoteViewsFactory` the launcher's adapter owns the item view's lifecycle and recycles it, and
     * the ticking does not survive that — so the clock only ever moved when something re-applied the
     * whole RemoteViews, which is exactly what a pause or a resize does. Added with `addView` into a
     * container in the widget's own root, each strip is an ordinary view and keeps its own time.
     *
     * ## Several at once
     *
     * `addView` takes as many as there are, so two habits being timed together works rather than
     * being forbidden — the day card allows it, and a widget that disabled every other play button
     * would be refusing something the app permits. The list below carries `layout_weight="1"` and
     * yields the space.
     *
     * ## What the clock's base is
     *
     * Not the start of the session. A strip shows the habit's *total* for the day — what was banked
     * plus what this session has added — so the base is pushed back by the banked seconds too.
     * Pausing then changes nothing visible, which is right: the time was already being counted, it
     * has just been written down.
     */
    private static void session(
        final Context context,
        final RemoteViews views,
        final JSONArray rows,
        final String dateKey,
        final Map<String, Integer> pending
    ) {
        views.removeAllViews(R.id.widget_sessions);
        boolean any = false;

        for (int index = 0; index < rows.length(); index++) {
            final JSONObject row = rows.optJSONObject(index);
            if (row == null || !"duration".equals(row.optString("format"))) {
                continue;
            }
            final String habitId = row.optString("id");
            final long startedAt = HabitsWidgetStore.readTimer(context, habitId, dateKey);
            if (startedAt <= 0L) {
                continue;
            }

            views.addView(
                R.id.widget_sessions, strip(context, row, habitId, dateKey, startedAt, pending));
            any = true;
        }

        views.setViewVisibility(R.id.widget_session_divider, any ? View.VISIBLE : View.GONE);
    }

    /** One lifted row. Deliberately the same shape as the duration row it replaces — see
        widget_habits_session.xml. */
    private static RemoteViews strip(
        final Context context,
        final JSONObject row,
        final String habitId,
        final String dateKey,
        final long startedAt,
        final Map<String, Integer> pending
    ) {
        final RemoteViews strip =
            new RemoteViews(context.getPackageName(), R.layout.widget_habits_session);

        final int banked = HabitsWidgetRow.valueOf(row, pending);
        final long sessionMs = Math.max(0L, System.currentTimeMillis() - startedAt);
        strip.setChronometer(
            R.id.session_clock,
            android.os.SystemClock.elapsedRealtime() - (banked * 1000L) - sessionMs,
            null,
            true
        );
        strip.setTextViewText(R.id.session_label, row.optString("label"));

        final int streak = row.optInt("streak");
        if (streak >= HabitsWidgetRow.STREAK_MIN) {
            strip.setViewVisibility(R.id.session_streak, View.VISIBLE);
            strip.setTextViewText(R.id.session_streak_count, String.valueOf(streak));
        } else {
            strip.setViewVisibility(R.id.session_streak, View.GONE);
        }

        final int target = row.optInt("target");
        if (target > 0) {
            strip.setViewVisibility(R.id.session_progress, View.VISIBLE);
            /* Counts the running session as well as the banked seconds, which is what HabitProgress
               does with its pale band: watching a session fill the bar is most of the point of having
               a timer. It advances only when something repaints, unlike the clock beside it — a bar
               moving a pixel a second is not information anyone reads. */
            final int live = banked + (int) (sessionMs / 1000L);
            strip.setProgressBar(R.id.session_progress, 100, Math.min(100, live * 100 / target), false);
        } else {
            strip.setViewVisibility(R.id.session_progress, View.GONE);
        }

        // Direct PendingIntents, not fill-ins: this is outside the collection, so it is allowed them
        // — and needs them, since no template reaches it.
        strip.setOnClickPendingIntent(R.id.session_pause, pauseIntent(context, habitId, dateKey));
        /* And one that does nothing, on the row itself. Without it a tap anywhere but the pause
           button travels up to the header's handler and opens the app — which the rows in the list
           never do, because a collection item with no fill-in intent absorbs its own taps. This is
           that behaviour, made explicit. */
        strip.setOnClickPendingIntent(R.id.session_root, noopIntent(context, habitId));
        return strip;
    }

    /**
     * A PendingIntent that exists only to be absorbed.
     *
     * Keyed by habit so that two lifted rows do not collapse onto one: `PendingIntent` identity
     * ignores extras and compares action, data and component, so without the per-habit URI the
     * second strip would share the first's — harmless for a no-op, and a trap for anyone who later
     * gives this a payload.
     */
    private static PendingIntent noopIntent(final Context context, final String habitId) {
        final Intent intent = new Intent(context, HabitsWidgetProvider.class)
            .setAction(ACTION_NOOP)
            .setData(Uri.parse("diary-habit-noop://" + habitId));
        return PendingIntent.getBroadcast(
            context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Pause, from the pinned strip. Same handler a row's pause button reaches through the template. */
    private static PendingIntent pauseIntent(
        final Context context,
        final String habitId,
        final String dateKey
    ) {
        final Intent intent = new Intent(context, HabitsWidgetProvider.class)
            .setAction(ACTION_OP)
            .setData(Uri.parse("diary-habit-session://" + habitId + "/" + dateKey))
            .putExtra(EXTRA_HABIT_ID, habitId)
            .putExtra(EXTRA_DATE_KEY, dateKey)
            .putExtra(EXTRA_TIMER, true);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, 0, intent, flags);
    }

    /** The empty, loading and stale states: one sentence where the list would be. */
    private static RemoteViews message(final Context context, final RemoteViews views, final String text) {
        views.setViewVisibility(R.id.widget_counter, View.GONE);
        views.setTextViewText(R.id.widget_message, text);
        /* Hidden explicitly, not left to the layout's default. An update re-applies actions onto the
           views the launcher already has rather than re-inflating them, so anything this pass does
           not set keeps whatever the last pass left — and a strip still counting under a "no
           habits" message is the kind of stale that reads as a broken widget. */
        views.removeAllViews(R.id.widget_sessions);
        views.setViewVisibility(R.id.widget_session_divider, View.GONE);
        return views;
    }

    /**
     * The one PendingIntent the whole list shares.
     *
     * Collection items cannot own a PendingIntent — one per row per button would be thousands of
     * them — so each contributes a `fillInIntent` with only its own extras and this supplies
     * everything else. `FLAG_MUTABLE` is not optional: filling in *is* mutation, and from Android 12
     * an immutable template silently produces buttons that do nothing at all.
     */
    private static PendingIntent template(final Context context) {
        final Intent intent = new Intent(context, HabitsWidgetProvider.class).setAction(ACTION_OP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        return PendingIntent.getBroadcast(context, 0, intent, flags);
    }

    /**
     * Open the app, on the day the widget is showing.
     *
     * An explicit component plus an https:// data URI, rather than relying on App Links verification:
     * naming MainActivity directly means Android delivers this without consulting
     * /.well-known/assetlinks.json, while the URI still arrives as an `appUrlOpen` for
     * `routeForUrl` to turn into a route. The host comes from the same gradle property the manifest's
     * intent-filter uses (`appHost` in build.gradle), so the link the widget builds and the links the
     * app claims cannot drift apart.
     */
    private static PendingIntent openApp(final Context context, final JSONObject snapshot) {
        final String dateKey = snapshot == null ? null : snapshot.optString("dateKey", null);
        final Uri url = Uri.parse(
            "https://" + context.getString(R.string.app_host) + "/diary" + (dateKey == null ? "" : "/" + dateKey)
        );

        final Intent intent = new Intent(Intent.ACTION_VIEW, url)
            .setClass(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
