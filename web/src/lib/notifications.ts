import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { addDays, set } from 'date-fns';
import { db, getMeta, setMeta, type LocalPerson } from '@/db/db';
import i18n from '@/i18n';
import { ageOn, daysUntilBirthday, nextOccurrence } from './birthday';
import { CHECKUP_DAY_MS } from './checkup';
import { toDateKey } from './dates';
import { isNative } from './native';

/* Native-only local notifications for checkup reminders, birthdays, and the daily "add
   something to your diary" nudge. No-ops on the web, mirroring lib/haptics.ts.
   Everything reads straight from Dexie so it works offline; call sites (mutations.ts,
   sync.ts's onSyncApplied, app resume) all just fire refreshNotifications() without awaiting.

   All three kinds are reconciled in ONE pass. They have to be: the reconcile cancels every
   pending notification it didn't just ask for, so a per-kind refresh would cancel the other
   kinds' notifications on every run. */

const DAILY_REMINDER_ID = 1;
/** How soon a just-discovered overdue checkup (or a birthday whose hour already passed) fires —
    there's no true native background poll, so "discovery" only happens on a refresh trigger. */
const CATCH_UP_DELAY_MS = 5_000;
/** Local hour birthday reminders fire at. */
const BIRTHDAY_HOUR = 9;
/** Don't book an alarm months out: Android caps pending exact alarms, and refreshNotifications
    runs on every app resume, mutation and sync — so a birthday is always armed well in time. */
const BIRTHDAY_LOOKAHEAD_DAYS = 30;

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/* Each kind hashes into its own half of the id space. They must not overlap: the reconcile
   below cancels any pending id it didn't just schedule, so a birthday landing on a checkup's
   id would make the two silently evict each other. Both halves stay under 2^31. */
const ID_SPACE = 0x3ffffffe;
const CHECKUP_ID_BASE = 2;
const BIRTHDAY_ID_BASE = 0x40000000;

/** Stable id per person, disjoint from DAILY_REMINDER_ID (reserved as 1) and from birthdays. */
function checkupNotificationId(personId: string): number {
  return CHECKUP_ID_BASE + (fnv1a(personId) % ID_SPACE);
}

function birthdayNotificationId(personId: string): number {
  return BIRTHDAY_ID_BASE + (fnv1a(personId) % ID_SPACE);
}

type NotifiedCheckups = Record<string, string>;

type LocalPeople = LocalPerson[];

/** Picks one of a set of lighthearted body templates and fills in the given placeholders.
    Interpolated by hand rather than via i18next's returnObjects + options, since that path's
    interpolation-on-arrays behavior isn't guaranteed across i18next versions. */
function pickTemplate(key: string, vars: Record<string, string> = {}): string {
  const templates = i18n.t(key, { returnObjects: true }) as string[];
  const template = templates[Math.floor(Math.random() * templates.length)];
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), template);
}

/**
 * One notification per person whose checkup is due.
 *
 * A future due date always gets scheduled for its exact moment (a true AlarmManager wake, fires
 * even if the app is killed). A due date already in the past — only discoverable because we have
 * no background poll — fires once as a near-immediate catch-up, tracked per `lastCheckupAt` in
 * `db.meta.notifiedCheckups` so an already-overdue person doesn't get re-notified on every
 * unrelated mutation until the checkup is marked done.
 */
async function collectCheckupNotifications(people: LocalPeople): Promise<LocalNotificationSchema[]> {
  const notified = (await getMeta<NotifiedCheckups>('notifiedCheckups')) ?? {};
  const nextNotified: NotifiedCheckups = {};
  const scheduled: LocalNotificationSchema[] = [];
  const now = Date.now();

  for (const person of people) {
    if (person.checkupIntervalDays == null) continue;
    const lastCheckupAt = Date.parse(person.lastCheckupAt);
    const dueAt = lastCheckupAt + person.checkupIntervalDays * CHECKUP_DAY_MS;

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
    const days = Math.round((at.getTime() - lastCheckupAt) / CHECKUP_DAY_MS);
    const checkupBody = pickTemplate('people.checkupBodies', { name: person.name, days: String(days) });
    scheduled.push({
      id: checkupNotificationId(person.id),
      title: i18n.t('people.checkupDueTitle', { name: person.name }),
      body: checkupBody,
      largeBody: checkupBody,
      schedule: { at, allowWhileIdle: true },
      extra: { kind: 'checkup', personId: person.id },
    });
  }

  await setMeta('notifiedCheckups', nextNotified);
  return scheduled;
}

/**
 * One notification per person whose birthday falls within the lookahead window.
 *
 * Same catch-up shape as checkups: if today *is* the birthday but BIRTHDAY_HOUR already passed
 * (the app was closed all morning), fire shortly instead of silently skipping a whole year.
 * `db.meta.notifiedBirthdays` records the occurrence already handled, keyed by date, so a
 * mutation at noon doesn't re-announce a birthday that was announced at 09:00.
 */
async function collectBirthdayNotifications(people: LocalPeople): Promise<LocalNotificationSchema[]> {
  const notified = (await getMeta<NotifiedCheckups>('notifiedBirthdays')) ?? {};
  const nextNotified: NotifiedCheckups = {};
  const scheduled: LocalNotificationSchema[] = [];
  const now = new Date();

  for (const person of people) {
    if (!person.birthday) continue;
    const occurrence = nextOccurrence(person.birthday, now, BIRTHDAY_HOUR);
    const daysAway = daysUntilBirthday(person.birthday, now);
    if (!occurrence || daysAway === null || daysAway > BIRTHDAY_LOOKAHEAD_DAYS) continue;

    const key = toDateKey(occurrence);
    const isToday = daysAway === 0;
    // Only today's occurrence needs guarding; a future one can't have fired yet.
    if (isToday) nextNotified[person.id] = key;

    let at = occurrence;
    if (occurrence.getTime() <= now.getTime()) {
      if (notified[person.id] === key) continue; // already announced this year
      at = new Date(Date.now() + CATCH_UP_DELAY_MS);
    }

    const age = ageOn(person.birthday, occurrence);
    const birthdayBody = pickTemplate('notifications.birthdayBodies', { name: person.name });
    scheduled.push({
      id: birthdayNotificationId(person.id),
      title:
        age === null
          ? i18n.t('notifications.birthdayTitle', { name: person.name })
          : i18n.t('notifications.birthdayTitleWithAge', { name: person.name, age }),
      body: birthdayBody,
      largeBody: birthdayBody,
      schedule: { at, allowWhileIdle: true },
      extra: { kind: 'birthday', personId: person.id },
    });
  }

  await setMeta('notifiedBirthdays', nextNotified);
  return scheduled;
}

/**
 * The fixed-id 23:45 nudge for the next candidate day (today if that time hasn't passed yet,
 * otherwise tomorrow). Returns nothing once that day already has an entry, which lets the
 * reconcile cancel it. Idempotent by design — no overdue-cycle tracking needed since the id's
 * meaning simply shifts forward each day.
 */
async function collectDailyReminder(): Promise<LocalNotificationSchema[]> {
  const now = new Date();
  let candidate = set(now, { hours: 23, minutes: 45, seconds: 0, milliseconds: 0 });
  if (candidate <= now) candidate = addDays(candidate, 1);

  const count = await db.entries.where('dateKey').equals(toDateKey(candidate)).count();
  if (count > 0) return [];

  const dailyBody = pickTemplate('notifications.dailyReminderBodies');
  return [
    {
      id: DAILY_REMINDER_ID,
      title: i18n.t('notifications.dailyReminderTitle'),
      body: dailyBody,
      largeBody: dailyBody,
      schedule: { at: candidate, allowWhileIdle: true },
      extra: { kind: 'daily' },
    },
  ];
}

/** Schedule everything that should exist right now, and cancel everything pending that shouldn't. */
async function reconcileNotifications(): Promise<void> {
  const people = await db.people.toArray();
  const [checkups, birthdays, daily] = await Promise.all([
    collectCheckupNotifications(people),
    collectBirthdayNotifications(people),
    collectDailyReminder(),
  ]);

  const desired = [...checkups, ...birthdays, ...daily];
  if (desired.length) await LocalNotifications.schedule({ notifications: desired });

  // Anything still pending that we didn't just ask for is stale: a person deleted, a checkup
  // marked done, a birthday cleared. Because this sees all three kinds at once it can no longer
  // cancel one kind while refreshing another.
  const desiredIds = new Set(desired.map((notification) => notification.id));
  const pending = await LocalNotifications.getPending();
  const stale = pending.notifications.filter((notification) => !desiredIds.has(notification.id));
  if (stale.length) {
    await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) });
  }
}

/** Fire-and-forget refresh; safe to call from any mutation/sync/resume path. */
export function refreshNotifications(): void {
  if (!isNative) return;
  reconcileNotifications().catch((err) => console.warn('notifications: refresh failed', err));
}

/** Call once at app bootstrap. Requests both the notification display permission
    (POST_NOTIFICATIONS on Android 13+) and, if needed, prompts the user to enable
    exact alarms (SCHEDULE_EXACT_ALARM, denied by default on Android 14+). Without
    exact alarm permission the plugin falls back to inexact non-wakeup alarms that
    Android can defer indefinitely. */
export async function initLocalNotifications(): Promise<void> {
  if (!isNative) return;
  await LocalNotifications.requestPermissions();

  // On Android 12+ exact alarms require an explicit user opt-in via system settings.
  // If the permission is missing or revoked, open the system screen so the user can
  // grant it. This is a no-op on older Android versions.
  try {
    const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting();
    if (exact_alarm !== 'granted') {
      await LocalNotifications.changeExactNotificationSetting();
    }
  } catch {
    // Pre-Android-12 or plugin version without exact-alarm API — safe to ignore.
  }

  refreshNotifications();
}
