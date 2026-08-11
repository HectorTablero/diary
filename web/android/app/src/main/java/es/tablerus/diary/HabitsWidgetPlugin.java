package es.tablerus.diary;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the home-screen widget to redraw.
 *
 * This is the entire native surface of the widget's data path, and it is one method with no
 * arguments on purpose. The state itself never comes through here — the web layer writes it with
 * `@capacitor/preferences`, which lands in the same SharedPreferences file the provider reads (see
 * HabitsWidgetStore), so there is nothing for a bridge call to carry.
 *
 * What SharedPreferences cannot do is make the widget notice. A placed widget repaints only when
 * something calls `AppWidgetManager.updateAppWidget`, or when `updatePeriodMillis` comes round —
 * and that has a 30-minute floor, which would make ticking a habit look broken. Hence one method,
 * meaning "now".
 *
 * Keeping it at that is what stops this class from ever needing to change again. A `setHabits`
 * method here would be the same mistake as putting the domain in the provider: it would give the
 * native layer an opinion about the plugin's shape, and it would need editing every time that
 * shape moved.
 */
@CapacitorPlugin(name = "HabitsWidget")
public class HabitsWidgetPlugin extends Plugin {

    @PluginMethod
    public void refresh(PluginCall call) {
        // No-op when no widget has been placed — renderAll checks for that. Resolved either way:
        // the caller is refreshing a surface that may not exist, which is not a failure.
        HabitsWidgetProvider.renderAll(getContext());
        call.resolve();
    }
}
