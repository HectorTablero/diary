import { isNative } from '@/lib/native';
import { captureError } from '@/lib/telemetry';
import { getEnabledPlugins } from './enabled';
import { PLUGINS } from './registry';

/**
 * Drives every enabled plugin's Android home-screen widget.
 *
 * ## Why this is not just an import in main.tsx
 *
 * Because rule 1 of the plugin contract (see registry.ts) says the entry chunk may not reach plugin
 * code, and a home-screen widget is exactly the kind of feature that tempts you to break it: it has
 * to be refreshed at boot, which is the one moment the entry chunk is all there is.
 *
 * So this walks the registry the same way the notification reconcile does, and in the same order —
 * `enabled` first, then `surfaces`, and only then `load()`. A user with the habits plugin switched
 * off never downloads its chunk to discover it has nothing to refresh; a user on the web never
 * downloads it either, because the whole pass is skipped off-device.
 *
 * ## Why failures are swallowed
 *
 * Every caller is a lifecycle hook with other things to do — boot, resume, a background wake-up.
 * A widget is a secondary surface, and a plugin whose chunk failed to load (a returning user,
 * offline, whose service worker no longer holds it) must not take the app down with it. The failure
 * is reported and the next pass tries again, which for a widget is at most a few minutes away.
 */
export async function syncNativeWidgets(
  options: {
    /**
     * One extra plugin id to refresh even though it is disabled.
     *
     * For the moment a plugin is switched *off*, which is the one time the enabled filter above
     * gives the wrong answer. Skipping a disabled plugin is right for every periodic pass and wrong
     * exactly once: the widget it left on the home screen is still sitting there, still showing the
     * habits of an account that has just turned them off, and nothing will ever come back to correct
     * it. A plugin's own `syncNativeWidget` writes an empty snapshot when it finds itself disabled —
     * it just has to be asked once more.
     *
     * Loading the chunk for a disabled plugin is a deliberate exception to rule 3, and a defensible
     * one: this only ever happens in response to someone toggling that exact plugin, so the user
     * paying the cost is the user who was using it a moment ago.
     */
    alsoInclude?: string;
    /**
     * Refresh every plugin that has a widget, enabled or not.
     *
     * For sign-out, where `alsoInclude` cannot help because the enabled set has already been emptied
     * and there is no single id to name. Without this the home screen would keep displaying the
     * previous account's habits — names, counts and streaks — to whoever picks the phone up next,
     * for as long as the widget stays placed. `clearLocalData()` wipes Dexie, so each plugin's own
     * refresh finds nothing and writes an empty snapshot; this is only what gets them asked.
     */
    includeDisabled?: boolean;
  } = {},
): Promise<void> {
  // The widget is an Android surface and nothing else — there is no browser equivalent to refresh,
  // and every plugin's implementation would immediately no-op anyway.
  if (!isNative) return;

  const enabled = getEnabledPlugins();
  const wanted = (id: string) =>
    options.includeDisabled || enabled.has(id) || id === options.alsoInclude;

  await Promise.all(
    PLUGINS.filter((plugin) => wanted(plugin.id) && plugin.surfaces.includes('widget')).map(
      async (plugin) => {
        try {
          const module = (await plugin.load()).default;
          await module.syncNativeWidget?.();
        } catch (err) {
          captureError(err, { scope: 'plugins.widget', pluginId: plugin.id });
        }
      },
    ),
  );
}
