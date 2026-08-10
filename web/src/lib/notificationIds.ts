/**
 * Which notification id belongs to what.
 *
 * Split out of lib/notifications.ts for the same reason notificationSchedule.ts was: this is pure
 * arithmetic, and keeping it here means it can be unit-tested — and, just as importantly, *imported*
 * — without dragging in @capacitor/local-notifications. The second half of that matters more than it
 * used to: the reconcile has to be able to say "these pending ids belong to plugin X" while X's
 * chunk is still unloaded, or worse, failed to load at all (see collectPluginNotifications).
 */

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/* Each kind hashes into its own third of the id space. They must not overlap: the reconcile in
   notifications.ts cancels any pending id it didn't just schedule, so a birthday landing on a
   checkup's id would make the two silently evict each other. All three thirds stay within a Java
   int — the top of the plugin range is exactly Integer.MAX_VALUE, which the test asserts, because
   this is arithmetic that goes wrong silently.

   These were halves until plugins needed a range of their own, and `fnv1a % ID_SPACE` left exactly
   two free ids above the birthday half — not enough to carve a third from. Repartitioning needed no
   migration, and that is a property of the reconcile rather than a lucky break: it cancels every
   pending id it didn't just schedule, and the "already announced" maps in db.meta are keyed by
   *personId*, never by notification id. So the first pass after this change re-schedules every
   person at its new id and cancels the old one, and because scheduling precedes cancelling, no
   alarm is unarmed in between.

   Negative ids would have been the other way to find room — Android and the Capacitor plugin both
   take any int — but the plugin does arithmetic on ids (it derives an action's PendingIntent request
   code by adding a hashCode), so staying in the shape this code already produces is the cheaper
   call. */
export const ID_SPACE = 0x2aaaaaaa;
export const CHECKUP_ID_BASE = 2;
export const BIRTHDAY_ID_BASE = 0x2aaaaaac;
export const PLUGIN_ID_BASE = 0x55555556;

/** The two fixed ids, below every hashed range. */
export const CHECKUP_DIGEST_ID = 0;
export const DAILY_REMINDER_ID = 1;

/** Stable id per person, disjoint from the fixed ids and from birthdays. */
export const checkupNotificationId = (personId: string): number =>
  CHECKUP_ID_BASE + (fnv1a(personId) % ID_SPACE);

export const birthdayNotificationId = (personId: string): number =>
  BIRTHDAY_ID_BASE + (fnv1a(personId) % ID_SPACE);

/**
 * How many plugins can hold reminder ids at once.
 *
 * The plugin third is cut into this many fixed contiguous slices rather than hashed like the two
 * above, and the difference is deliberate. A hash gives a plugin its ids but tells you nothing about
 * an id you are holding — and the reconcile needs the reverse lookup: when a plugin fails to load,
 * its pending ids must be *left alone* rather than swept, which means recognising them from the id
 * itself, with the chunk unavailable. A contiguous slice makes that a range check.
 */
export const MAX_NOTIFYING_PLUGINS = 32;
const PLUGIN_SLICE = Math.floor(ID_SPACE / MAX_NOTIFYING_PLUGINS);

/** The half-open id range `[start, end)` owned by the plugin at `slot`. */
export function pluginIdRange(slot: number): { start: number; end: number } {
  const start = PLUGIN_ID_BASE + slot * PLUGIN_SLICE;
  return { start, end: start + PLUGIN_SLICE };
}

/** A stable id within a plugin's own slice. `key` is scoped to the plugin, so two plugins using the
    same key still land in different slices. */
export const pluginNotificationId = (slot: number, key: string): number =>
  pluginIdRange(slot).start + (fnv1a(key) % PLUGIN_SLICE);
