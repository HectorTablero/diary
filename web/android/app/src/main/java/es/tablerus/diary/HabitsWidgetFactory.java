package es.tablerus.diary;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Builds one habit row at a time, on demand, for the launcher's list.
 *
 * ## What changed by moving here
 *
 * The rows used to be assembled by the provider and appended with `addView`, which produced a list
 * that could not scroll and was therefore cropped when it outgrew the widget. As a collection they
 * scroll, but two things about them have to work differently, and both are easy to get wrong
 * silently:
 *
 * **Clicks.** A collection item may not carry its own `PendingIntent` — creating one per row per
 * button would be thousands of them, which is exactly why the API refuses. Instead the provider
 * installs a single *template* on the list and each view here contributes a `fillInIntent` holding
 * only its own extras. The two are merged when the tap happens. A view with no fill-in intent is
 * simply not clickable, and the failure looks like a dead button rather than an error.
 *
 * **State.** This runs in a different call from the provider's render, so it cannot be handed
 * anything. It re-reads the snapshot and the un-drained presses itself, which is safe because both
 * live in SharedPreferences and neither is expensive. `onDataSetChanged` is the launcher telling us
 * to do that again.
 *
 * ## Why it still knows nothing about habits
 *
 * Same contract as before: a row arrives as a finished statement about one day — a label, a number,
 * a goal, a step — and this draws it. The plugin's rules stay in TypeScript. See the notes on
 * `HabitsWidgetProvider` and widgetSnapshot.ts.
 */
class HabitsWidgetFactory implements RemoteViewsService.RemoteViewsFactory {

    /** Above this the mood faces fit beside the label; below it they need a line of their own.
        Measured against the widget's own reported width, not the screen's. */
    private static final int MOOD_INLINE_MIN_WIDTH_DP = 250;

    private final Context context;
    private final int appWidgetId;

    /** Everything the current render needs, replaced wholesale by `onDataSetChanged`. */
    private JSONArray rows = new JSONArray();
    private JSONObject strings = new JSONObject();
    private String dateKey = "";
    private Map<String, Integer> pending = java.util.Collections.emptyMap();
    private boolean moodInline = false;

    HabitsWidgetFactory(final Context context, final Intent intent) {
        this.context = context;
        this.appWidgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        );
    }

    @Override
    public void onCreate() {
        onDataSetChanged();
    }

    /**
     * Re-read everything.
     *
     * Called by the launcher on creation and whenever `notifyAppWidgetViewDataChanged` fires — which
     * the provider does after a press, after the app writes a snapshot, and when the widget is
     * resized. Runs on a binder thread with a generous budget, so reading SharedPreferences here is
     * the right place for it rather than something to defer.
     */
    @Override
    public void onDataSetChanged() {
        final JSONObject snapshot = HabitsWidgetStore.readSnapshot(context);
        final String today = HabitsWidgetProvider.today();

        /* An absent, unreadable or stale snapshot yields no rows at all, which is what makes the
           list's empty view appear. The provider writes the sentence that goes in it; the two must
           agree about *when* there is nothing to show, so both ask exactly this question. */
        if (snapshot == null || !today.equals(snapshot.optString("dateKey"))) {
            rows = new JSONArray();
            pending = java.util.Collections.emptyMap();
            return;
        }

        dateKey = snapshot.optString("dateKey");
        rows = withoutRunningTimer(snapshot.optJSONArray("rows"), dateKey);
        final JSONObject text = snapshot.optJSONObject("strings");
        strings = text == null ? new JSONObject() : text;
        pending = HabitsWidgetStore.pendingDeltas(context, dateKey);

        /* Whether five faces fit beside a label is a question about this widget's width, which only
           the widget itself can answer — a phone-sized screen says nothing about a two-cell widget
           on it. `getAppWidgetOptions` reports the size the launcher has actually given us, and the
           provider re-notifies this factory whenever that changes. */
        moodInline = false;
        if (appWidgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
            final Bundle options = AppWidgetManager.getInstance(context).getAppWidgetOptions(appWidgetId);
            if (options != null) {
                final int width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                moodInline = width >= MOOD_INLINE_MIN_WIDTH_DP;
            }
        }
    }

    /**
     * Every row except the one currently being timed.
     *
     * The running habit is drawn above the list instead, by the provider, because that is the only
     * place a Chronometer ticks (see widget_habits.xml). Dropping it from here is what makes that a
     * *move* rather than a duplicate: the row leaves the list, appears at the top with its clock
     * running, and returns to its place on pause.
     *
     * Only the list is filtered. The header's "3/5" still counts every habit the day asks about —
     * lifting a row out of the list does not stop it being one of them.
     */
    private JSONArray withoutRunningTimer(final JSONArray all, final String dateKey) {
        if (all == null) {
            return new JSONArray();
        }
        final JSONArray kept = new JSONArray();
        for (int index = 0; index < all.length(); index++) {
            final JSONObject row = all.optJSONObject(index);
            if (row == null) {
                continue;
            }
            final boolean running = "duration".equals(row.optString("format"))
                && HabitsWidgetStore.readTimer(context, row.optString("id"), dateKey) > 0L;
            if (!running) {
                kept.put(row);
            }
        }
        return kept;
    }

    @Override
    public void onDestroy() {
        rows = new JSONArray();
    }

    @Override
    public int getCount() {
        return rows.length();
    }

    @Override
    public RemoteViews getViewAt(final int position) {
        final JSONObject row = rows.optJSONObject(position);
        if (row == null) {
            return new RemoteViews(context.getPackageName(), R.layout.widget_habits_row);
        }
        return HabitsWidgetRow.build(context, row, strings, dateKey, pending, moodInline);
    }

    /**
     * Shown in a row's place while its real view is being fetched.
     *
     * A blank of roughly the right height rather than null: returning null makes the launcher draw
     * nothing at all, so a list being refreshed flickers to empty and back. This keeps the shape.
     */
    @Override
    public RemoteViews getLoadingView() {
        return new RemoteViews(context.getPackageName(), R.layout.widget_habits_row_loading);
    }

    @Override
    public int getViewTypeCount() {
        // Three distinct row layouts: the shared one, and the two mood variants. The launcher uses
        // this to size its recycler, and under-reporting it corrupts the list.
        return 3;
    }

    @Override
    public long getItemId(final int position) {
        final JSONObject row = rows.optJSONObject(position);
        final String id = row == null ? null : row.optString("id");
        // A habit's own row id, so the launcher's recycling follows the habit rather than the
        // position — otherwise reordering or archiving one animates every row below it.
        return TextUtils.isEmpty(id) ? position : id.hashCode();
    }

    @Override
    public boolean hasStableIds() {
        return true;
    }
}
