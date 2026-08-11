package es.tablerus.diary;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViewsService;

/**
 * Serves the widget's habit list to the launcher.
 *
 * A home-screen widget cannot scroll a `LinearLayout` it filled with `addView` — that list is as
 * tall as it is, and a launcher will happily crop the bottom of it, which is what made the last
 * habit look squashed and then sliced. Scrolling in RemoteViews means a collection view, and a
 * collection view means an adapter living in a service the launcher binds to.
 *
 * `RemoteViewsService` rather than the newer `setRemoteAdapter(RemoteCollectionItems)`: the latter
 * needs API 31 and this app supports 24, and keeping one implementation for every device is worth
 * more than the boilerplate the modern API saves. The launcher binds this, calls the factory below
 * across the process boundary, and caches what it gets — see `HabitsWidgetFactory`.
 *
 * Declared in the manifest with `android:permission="android.permission.BIND_REMOTEVIEWS"`, which
 * is what stops any other app binding it and reading the diary's habit names out of it.
 */
public class HabitsWidgetService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(final Intent intent) {
        return new HabitsWidgetFactory(getApplicationContext(), intent);
    }
}
