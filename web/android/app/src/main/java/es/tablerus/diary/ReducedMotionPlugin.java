package es.tablerus.diary;

import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reports whether the system is set to remove animations.
 *
 * The web layer already honours `prefers-reduced-motion`, and that is the only signal it gets on
 * the web. Inside the WebView it cannot be relied on: the media query is resolved from preferences
 * the WebView computes when it is created, so at best it is decided once at launch and a setting
 * flipped afterwards never reaches a running page — and on the WebView builds this app actually
 * meets, it does not arrive at all. Neither is something the app can fix from the JavaScript side,
 * because nothing there can see the system setting.
 *
 * So the value is read here and pushed into the page (see lib/reducedMotion.ts), which ORs it with
 * the media query rather than replacing it: whichever signal says "reduce" wins, so this stays
 * correct on the web, on a WebView that does support the query, and on one that doesn't.
 *
 * ANIMATOR_DURATION_SCALE is the setting Android itself treats as the answer — Accessibility >
 * Remove animations writes 0 to it (along with the window and transition scales), and it is the
 * one the platform's own animation APIs consult. Reading only it means Developer options can still
 * be used to scale window transitions without the app deciding the user wants no motion at all.
 */
@CapacitorPlugin(name = "ReducedMotion")
public class ReducedMotionPlugin extends Plugin {

    @PluginMethod
    public void isReduced(PluginCall call) {
        // The three-argument form returns the default when the setting has never been written,
        // so an unset value reads as 1f (normal motion) rather than throwing.
        float scale = Settings.Global.getFloat(
            getContext().getContentResolver(),
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f
        );
        JSObject result = new JSObject();
        result.put("reduced", scale == 0f);
        call.resolve(result);
    }
}
