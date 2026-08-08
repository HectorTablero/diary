import { BackgroundFetch } from '@transistorsoft/capacitor-background-fetch';
import { syncNow } from '@/db/sync';
import { isNative } from './native';
import { refreshNotificationsNow } from './notifications';
import { captureError, trackEvent } from './telemetry';

/* Periodic background sync for the Android app.
 *
 * While the app is open, db/sync.ts's own triggers (60s interval, visibilitychange, online, the
 * live WebSocket) keep it current. This covers the rest: Android hands the app a wake-up roughly
 * every 15 minutes via WorkManager, and we spend it on exactly the work a foreground sync does.
 *
 * Deliberately not a parallel implementation. The task calls syncNow() — the same push-outbox-then-
 * pull engine every other trigger calls — and then the same notification reconcile, so a background
 * pass can never drift from a foreground one, and a bug fixed in one is fixed in both. That is also
 * why this lives in the WebView rather than in a detached JS runtime: Dexie *is* the source of
 * truth, and a runtime without IndexedDB could only ever approximate it.
 *
 * What it cannot do: once Android reclaims or the user force-stops the app, no JavaScript of ours
 * runs at all. Notifications already scheduled survive that (they are real AlarmManager alarms),
 * so the practical loss is discovering *new* reasons to notify while the app is fully dead.
 */

/** Android floors any shorter request at 15 minutes anyway (WorkManager's minimum period). */
const MINIMUM_FETCH_INTERVAL_MINUTES = 15;

async function runBackgroundSync(): Promise<void> {
  // syncNow swallows its own network/auth failures and resolves either way, so an offline wake-up
  // still falls through to the reconcile below — which is the half that matters offline anyway,
  // since a rolled-over day changes which reminders should be armed with no server involved.
  await syncNow({ trigger: 'background' });
  await refreshNotificationsNow();
}

/** Call once at app bootstrap, before the first render — Android may launch the app straight into
    a background fetch event, and a handler registered later would miss it. No-op off-native. */
export async function initBackgroundSync(): Promise<void> {
  if (!isNative) return;
  try {
    const status = await BackgroundFetch.configure(
      {
        minimumFetchInterval: MINIMUM_FETCH_INTERVAL_MINUTES,
        // Keep the schedule across app termination, and re-register it after a reboot.
        stopOnTerminate: false,
        startOnBoot: true,
        // Headless mode would need a native Java task; our work is JavaScript by definition.
        enableHeadless: false,
        // No constraints: we want the wake-up even on a metered connection or a low battery,
        // because the notification reconcile is useful with no connection at all.
        requiredNetworkType: BackgroundFetch.NETWORK_TYPE_NONE,
        requiresCharging: false,
        requiresDeviceIdle: false,
        requiresBatteryNotLow: false,
        requiresStorageNotLow: false,
      },
      async (taskId) => {
        /* Every one of these is worth a row, and there are at most ~96 a day per device: Android
           grants the slot roughly every fifteen minutes and no more often. The rate is the point —
           a device where the OS has quietly stopped granting them at all looks, from the server,
           exactly like a device nobody is using, and the two need telling apart. */
        const startedAt = performance.now();
        try {
          await runBackgroundSync();
          trackEvent('background_fetch', {
            outcome: 'completed',
            duration_ms: Math.round(performance.now() - startedAt),
          });
        } catch (err) {
          // runBackgroundSync's own calls swallow their failures, so anything arriving here is
          // unexpected — and it happens where no user could ever see it.
          captureError(err, { scope: 'backgroundSync.task' });
        } finally {
          // Unconditional: not reporting back gets the app's background execution throttled.
          void BackgroundFetch.finish(taskId);
        }
      },
      async (taskId) => {
        // The OS withdrew the remaining background time. Whatever the sync got through is already
        // committed to Dexie (and replays from the outbox next time) — just hand the slot back.
        console.warn('backgroundSync: OS timeout', taskId);
        // Not an error: the slot is a loan and Android is entitled to call it in. It becomes one
        // if it is *most* of them, which is a rate this can be divided by the line above to get.
        trackEvent('background_fetch', { outcome: 'os_timeout' });
        void BackgroundFetch.finish(taskId);
      },
    );
    if (status !== BackgroundFetch.STATUS_AVAILABLE) {
      // The user (or a device policy) turned background activity off. Foreground sync is unaffected,
      // so there is nothing to recover from — just don't leave it looking like it worked.
      console.warn('backgroundSync: unavailable, status', status);
      // Once per launch, and it explains every subsequent silence from this device.
      trackEvent('background_fetch_unavailable', { status });
    }
  } catch (err) {
    console.warn('backgroundSync: configure failed', err);
    captureError(err, { scope: 'backgroundSync.configure' });
  }
}
