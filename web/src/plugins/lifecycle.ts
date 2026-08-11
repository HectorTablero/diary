import { onSyncApplied } from '@/db/sync';
import { captureError } from '@/lib/telemetry';
import { refreshEnabledPlugins } from './enabled';
import { syncNativeWidgets } from './nativeWidgets';

/**
 * Keeping the plugin system in step with what has synced.
 *
 * ## The bug this exists to prevent
 *
 * Which plugins are on is a property of the *account* — it lives in each plugin's `config` row, it
 * goes through the outbox, and the server carries it in both directions. All of that worked. What
 * did not was the last step: `refreshEnabledPlugins` is what turns those synced rows back into the
 * in-memory set the UI reads, and nothing ever called it. Its own docblock said "call after a sync
 * applies, and once at startup", and neither happened.
 *
 * The result looked exactly like enablement not syncing at all. The set was seeded from the
 * localStorage mirror at module load and thereafter only ever changed by `setPluginEnabled` on this
 * device, so a plugin switched on elsewhere landed in Dexie and stayed invisible — and on a device
 * with an empty mirror (a fresh install, or anything after `clearLocalData`) it stayed invisible
 * permanently, because the mirror is a cache that nothing was refilling.
 *
 * ## Why it is a module rather than two lines in main.tsx
 *
 * Because two lines in main.tsx are exactly what was missing, and nothing could have noticed. The
 * entry point is not importable from a test, so wiring that lives there is wiring no assertion can
 * reach. Here it can be, and `lifecycle.test.ts` pins the part that was wrong: that the refresh is
 * attached to sync at all.
 */

/**
 * Re-read plugin state from the local store and restate it for any native surface.
 *
 * Order matters and is the reason these two are one call rather than two listeners. The widget's
 * refresh asks `isPluginEnabled` to decide whether to draw habits or an empty card, so running it
 * before the enabled set has caught up would push a snapshot built on the previous answer — and on
 * the pass right after a plugin is enabled elsewhere, that is precisely the wrong one.
 *
 * Never throws. Every caller is a lifecycle hook with other work to do, and neither half of this is
 * worth failing a startup or a sync over.
 */
export async function refreshPlugins(): Promise<void> {
  try {
    await refreshEnabledPlugins();
  } catch (err) {
    captureError(err, { scope: 'plugins.refreshEnabled' });
  }
  // Guarded separately: a widget that failed to repaint must not stop the enabled set being
  // correct, which is the half the whole UI depends on.
  await syncNativeWidgets();
}

/**
 * Start reconciling, and keep reconciling.
 *
 * Called once from the entry point. The startup pass is what makes a fresh device — or one that has
 * just signed in — discover the plugins the account already has switched on; the subscription is
 * what makes a change on another device arrive without a reload.
 */
export function initPlugins(): () => void {
  void refreshPlugins();
  return onSyncApplied(() => void refreshPlugins());
}
