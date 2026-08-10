import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { db } from '@/db/db';
import { pluginIdRange } from '@/lib/notificationIds';
import { ensurePluginLocales } from './i18n';
import { PLUGINS, pluginSlot } from './registry';

/**
 * What enabled plugins want armed, folded into the app's single reconcile pass.
 *
 * A plugin never talks to the notification plugin itself. The reconcile in lib/notifications.ts
 * cancels every pending id it did not just schedule, so a second scheduler would silently disarm
 * the first — which is why all three existing kinds are collected in one pass, and why a fourth has
 * to join it rather than run beside it.
 *
 * ## The failure rule, which is the whole reason this file is careful
 *
 * A plugin's contribution comes from a dynamically imported chunk, so it can fail in ways the other
 * three collectors cannot: an evicted cache, a device offline after an update, a bug in the plugin.
 * Two obvious responses are both wrong.
 *
 *   - Letting it throw kills the *whole* pass. `refreshNotificationsNow` catches and warns, but by
 *     then the reconcile has died before both `schedule()` and `cancel()` — so a plugin chunk
 *     failing to fetch would stop checkups, birthdays and the daily nudge from updating too. One
 *     plugin must not be able to disarm the diary.
 *   - Returning `[]` is worse than it looks. An empty contribution means the plugin's pending ids
 *     are not in `desiredIds`, so the sweep treats them as stale and cancels them — and a user on a
 *     train with an evicted chunk silently loses a reminder they had set up weeks ago.
 *
 * So a failed plugin contributes nothing *and* protects its own slice of the id space from the
 * sweep: its existing alarms stay exactly as they were until a pass can speak for them again. That
 * is why each plugin owns a contiguous range derived from its position in the registry — the
 * reconcile has to recognise an id as belonging to a plugin whose code it could not load.
 */

export interface PluginNotifications {
  notifications: LocalNotificationSchema[];
  /** Half-open `[start, end)` id ranges the cancel sweep must leave alone. */
  protectedRanges: { start: number; end: number }[];
}

const NOTHING: PluginNotifications = { notifications: [], protectedRanges: [] };

/**
 * How long one plugin gets to produce its notifications.
 *
 * The reconcile is awaited inside the Android background-fetch wake-up, and the OS closes that
 * window as soon as the task reports done — an unbounded dynamic import there risks the whole pass
 * being killed mid-flight, which is worse than a half-finished one because `schedule()` may have
 * run and `cancel()` may not. A plugin that overruns is treated exactly like one that threw: no
 * contribution, range protected.
 */
const PLUGIN_TIMEOUT_MS = 5_000;

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('plugin notifications: timed out')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err as Error);
      },
    );
  });

/**
 * Which plugins are on, read straight from the synced config rows.
 *
 * Deliberately not through `plugins/enabled` — that reaches Dexie via `db/pluginRecords`, which
 * imports the outbox, which imports lib/notifications. Reading the table here keeps this file out
 * of that cycle, and it is the authoritative answer rather than the localStorage cache.
 */
async function enabledPluginIds(): Promise<Set<string>> {
  const configs = await db.pluginRecords.where('scope').equals('config').toArray();
  return new Set(
    configs
      .filter((row) => (row.data as { enabled?: unknown }).enabled === true)
      .map((row) => row.pluginId),
  );
}

/**
 * @param timeoutMs Budget per plugin. A parameter rather than a constant because the caller knows
 * how much time it has: a foreground reconcile can afford the default, while a background-fetch
 * wake-up is spending a window the OS will close on it.
 */
export async function collectPluginNotifications(
  timeoutMs = PLUGIN_TIMEOUT_MS,
): Promise<PluginNotifications> {
  /* The common case, and it must cost nothing: no registered plugin declares reminders, or none is
     enabled, so this returns before touching Dexie or importing anything. */
  const candidates = PLUGINS.filter((plugin) => plugin.surfaces.includes('notifications'));
  if (!candidates.length) return NOTHING;

  const enabled = await enabledPluginIds();
  const active = candidates.filter((plugin) => enabled.has(plugin.id));
  if (!active.length) return NOTHING;

  const notifications: LocalNotificationSchema[] = [];
  const protectedRanges: { start: number; end: number }[] = [];

  /* Sequential, not Promise.all: these run inside a background wake-up whose budget is shared, and
     the timeout above is per plugin. A handful of plugins is the realistic ceiling. */
  for (const plugin of active) {
    const slot = pluginSlot(plugin.id);
    try {
      const [module] = await withTimeout(
        Promise.all([plugin.load(), ensurePluginLocales(plugin.id)]),
        timeoutMs,
      );
      const collect = module.default.collectNotifications;
      if (!collect) continue;
      const produced = await withTimeout(collect({ slot }), timeoutMs);
      /* An id outside the plugin's own slice would collide with another plugin's alarms, or with a
         checkup's. Dropped rather than trusted — a plugin cannot be allowed to evict the diary's
         own reminders by returning the wrong number. */
      const { start, end } = pluginIdRange(slot);
      notifications.push(...produced.filter((n) => n.id >= start && n.id < end));
    } catch (err) {
      console.warn(`notifications: plugin "${plugin.id}" contributed nothing`, err);
      protectedRanges.push(pluginIdRange(slot));
    }
  }

  return { notifications, protectedRanges };
}

/** Whether an already-pending id belongs to a plugin that could not speak for itself this pass. */
export const isProtectedId = (
  id: number,
  ranges: readonly { start: number; end: number }[],
): boolean => ranges.some((range) => id >= range.start && id < range.end);
