import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { addDays, set } from 'date-fns';
import { db, getMeta, setMeta } from '@/db/db';
import i18n from '@/i18n';
import { CHECKUP_DAY_MS } from './checkup';
import { toDateKey } from './dates';
import { isNative } from './native';

/* Native-only local notifications for checkup reminders and the daily "add
   something to your diary" nudge. No-ops on the web, mirroring lib/haptics.ts.
   Both refresh functions read straight from Dexie so they work offline; call
   sites (mutations.ts, sync.ts's onSyncApplied, app resume) all just fire
   refreshNotifications() without awaiting it. */

const DAILY_REMINDER_ID = 1;
/** How soon a just-discovered overdue checkup fires — there's no true native
    background poll, so "discovery" only happens on a refresh trigger. */
const CATCH_UP_DELAY_MS = 5_000;

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable id per person, disjoint from DAILY_REMINDER_ID (reserved as 1). */
function checkupNotificationId(personId: string): number {
  return (fnv1a(personId) % 0x7ffffffe) + 2;
}

type NotifiedCheckups = Record<string, string>;

/**
 * (Re)schedules one notification per person whose checkup is due.
 *
 * A future due date always gets scheduled for its exact moment (a true
 * AlarmManager wake, fires even if the app is killed). A due date already in
 * the past — only discoverable because we have no background poll — fires
 * once as a near-immediate catch-up, tracked per `lastCheckupAt` in
 * `db.meta.notifiedCheckups` so an already-overdue person doesn't get
 * re-notified on every unrelated mutation until the checkup is marked done.
 */
async function refreshCheckupNotifications(): Promise<void> {
  const people = await db.people.toArray();
  const notified = (await getMeta<NotifiedCheckups>('notifiedCheckups')) ?? {};
  const nextNotified: NotifiedCheckups = {};
  const desiredIds = new Set<number>();
  const toSchedule: LocalNotificationSchema[] = [];
  const now = Date.now();

  for (const person of people) {
    if (person.checkupIntervalDays == null) continue;
    const id = checkupNotificationId(person.id);
    const dueAt = Date.parse(person.lastCheckupAt) + person.checkupIntervalDays * CHECKUP_DAY_MS;

    let at: Date | null = null;
    if (dueAt > now) {
      at = new Date(dueAt);
    } else if (notified[person.id] !== person.lastCheckupAt) {
      at = new Date(now + CATCH_UP_DELAY_MS);
      nextNotified[person.id] = person.lastCheckupAt;
    } else {
      nextNotified[person.id] = person.lastCheckupAt; // already notified this cycle, keep tracking
    }

    if (!at) continue;
    desiredIds.add(id);
    toSchedule.push({
      id,
      title: i18n.t('people.checkupDueTitle', { name: person.name }),
      body: i18n.t('people.checkupDueDescription'),
      schedule: { at },
      extra: { kind: 'checkup', personId: person.id },
    });
  }

  await setMeta('notifiedCheckups', nextNotified);
  if (toSchedule.length) await LocalNotifications.schedule({ notifications: toSchedule });

  const pending = await LocalNotifications.getPending();
  const stale = pending.notifications.filter((n) => n.id !== DAILY_REMINDER_ID && !desiredIds.has(n.id));
  if (stale.length) {
    await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) });
  }
}

/**
 * (Re)schedules the fixed-id 23:45 nudge for the next candidate day (today if
 * that time hasn't passed yet, otherwise tomorrow), or cancels it once that
 * day already has an entry. Idempotent by design — no overdue-cycle tracking
 * needed since the id's meaning simply shifts forward each day.
 */
async function refreshDailyReminder(): Promise<void> {
  const now = new Date();
  let candidate = set(now, { hours: 23, minutes: 45, seconds: 0, milliseconds: 0 });
  if (candidate <= now) candidate = addDays(candidate, 1);

  const count = await db.entries.where('dateKey').equals(toDateKey(candidate)).count();
  if (count > 0) {
    await LocalNotifications.cancel({ notifications: [{ id: DAILY_REMINDER_ID }] });
    return;
  }
  await LocalNotifications.schedule({
    notifications: [
      {
        id: DAILY_REMINDER_ID,
        title: i18n.t('notifications.dailyReminderTitle'),
        body: i18n.t('notifications.dailyReminderBody'),
        schedule: { at: candidate },
        extra: { kind: 'daily' },
      },
    ],
  });
}

/** Fire-and-forget refresh; safe to call from any mutation/sync/resume path. */
export function refreshNotifications(): void {
  if (!isNative) return;
  refreshCheckupNotifications().catch((err) => console.warn('notifications: checkup refresh failed', err));
  refreshDailyReminder().catch((err) => console.warn('notifications: daily reminder refresh failed', err));
}

/** Call once at app bootstrap. Scheduling itself doesn't need the permission
    (only the visual notification is suppressed until it's granted), so this
    never blocks refreshNotifications(). */
export function initLocalNotifications(): void {
  if (!isNative) return;
  void LocalNotifications.requestPermissions();
  refreshNotifications();
}
