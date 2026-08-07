import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { db, getMeta, setMeta, type LocalPerson } from '@/db/db';
import i18n from '@/i18n';
import { ageOn, daysUntilBirthday, nextOccurrence } from './birthday';
import { CHECKUP_DAY_MS } from './checkup';
import { toDateKey } from './dates';
import { isNative } from './native';
import { birthdayFireAt, nextDailyReminderAt, nextWakingTime } from './notificationSchedule';
import { getPreferences, type Preferences } from './preferences';

/* Native-only local notifications for checkup reminders, birthdays, and the daily "add
   something to your diary" nudge. No-ops on the web, mirroring lib/haptics.ts.
   Everything reads straight from Dexie so it works offline; call sites (mutations.ts,
   sync.ts's onSyncApplied, app resume) all just fire refreshNotifications() without awaiting.

   All three kinds are reconciled in ONE pass. They have to be: the reconcile cancels every
   pending notification it didn't just ask for, so a per-kind refresh would cancel the other
   kinds' notifications on every run. */

const DAILY_REMINDER_ID = 1;
/** Several overdue checkups at once become one digest instead of a burst — importing an address
    book and coming back a month later otherwise buzzes once per person, all in the same second. */
const CHECKUP_DIGEST_ID = 0;
const CHECKUP_DIGEST_THRESHOLD = 3;
/** Names listed in the digest body before it stops enumerating. */
const CHECKUP_DIGEST_NAMES = 3;
/** How soon a just-discovered overdue checkup (or a birthday whose hour already passed) fires —
    there's no true native background poll, so "discovery" only happens on a refresh trigger. */
const CATCH_UP_DELAY_MS = 5_000;
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

/** Stable id per person, disjoint from the two fixed ids (0 and 1) and from birthdays. */
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
async function collectCheckupNotifications(
  people: LocalPeople,
  prefs: Preferences,
): Promise<LocalNotificationSchema[]> {
  if (!prefs.checkupReminders) return [];

  const notified = (await getMeta<NotifiedCheckups>('notifiedCheckups')) ?? {};
  const nextNotified: NotifiedCheckups = {};
  const scheduled: LocalNotificationSchema[] = [];
  const overdue: { person: LocalPerson; lastCheckupAt: number }[] = [];
  const now = Date.now();

  for (const person of people) {
    if (person.checkupIntervalDays == null) continue;
    const lastCheckupAt = Date.parse(person.lastCheckupAt);
    const dueAt = lastCheckupAt + person.checkupIntervalDays * CHECKUP_DAY_MS;

    if (dueAt > now) {
      /* The due moment inherits its clock time from whenever the checkup was last marked done, so
         marking one at 03:12 would otherwise mean a 03:12 reminder every cycle from then on. The
         user never chose that minute, which is exactly the case quiet hours exist for. */
      const at = nextWakingTime(new Date(dueAt), prefs.quietHoursStart, prefs.quietHoursEnd);
      scheduled.push(checkupNotification(person, at, lastCheckupAt));
      continue;
    }

    // Keep tracking either way: dropping the entry would re-announce this cycle on the next pass.
    nextNotified[person.id] = person.lastCheckupAt;
    if (notified[person.id] !== person.lastCheckupAt) overdue.push({ person, lastCheckupAt });
  }

  if (overdue.length) {
    const at = nextWakingTime(
      new Date(now + CATCH_UP_DELAY_MS),
      prefs.quietHoursStart,
      prefs.quietHoursEnd,
    );
    if (overdue.length <= CHECKUP_DIGEST_THRESHOLD) {
      for (const { person, lastCheckupAt } of overdue) {
        scheduled.push(checkupNotification(person, at, lastCheckupAt));
      }
    } else {
      scheduled.push(checkupDigest(overdue.map(({ person }) => person.name), at));
    }
  }

  await setMeta('notifiedCheckups', nextNotified);
  return scheduled;
}

function checkupNotification(
  person: LocalPerson,
  at: Date,
  lastCheckupAt: number,
): LocalNotificationSchema {
  const days = Math.round((at.getTime() - lastCheckupAt) / CHECKUP_DAY_MS);
  const body = pickTemplate('people.checkupBodies', { name: person.name, days: String(days) });
  return {
    id: checkupNotificationId(person.id),
    title: i18n.t('people.checkupDueTitle', { name: person.name }),
    body,
    largeBody: body,
    schedule: { at, allowWhileIdle: true },
    extra: { kind: 'checkup', personId: person.id },
  };
}

/** One notification standing in for a whole backlog. Taps through to the people list, which
    already hoists overdue checkups to the top. */
function checkupDigest(names: string[], at: Date): LocalNotificationSchema {
  // 'conjunction' so the body reads as a sentence ("Ana, Bea and Chris"), not as a bare list.
  const listed = new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(
    names.slice(0, CHECKUP_DIGEST_NAMES),
  );
  const body = i18n.t('people.checkupDigestBody', { names: listed });
  return {
    id: CHECKUP_DIGEST_ID,
    title: i18n.t('people.checkupDigestTitle', { count: names.length }),
    body,
    largeBody: body,
    schedule: { at, allowWhileIdle: true },
    extra: { kind: 'checkupDigest' },
  };
}

/**
 * One notification per person whose birthday falls within the lookahead window.
 *
 * Same catch-up shape as checkups: if today *is* the birthday but BIRTHDAY_HOUR already passed
 * (the app was closed all morning), fire shortly instead of silently skipping a whole year.
 * `db.meta.notifiedBirthdays` records the occurrence already handled, keyed by date, so a
 * mutation at noon doesn't re-announce a birthday that was announced at 09:00.
 */
async function collectBirthdayNotifications(
  people: LocalPeople,
  prefs: Preferences,
): Promise<LocalNotificationSchema[]> {
  if (!prefs.birthdayReminders) return [];

  const notified = (await getMeta<NotifiedCheckups>('notifiedBirthdays')) ?? {};
  const nextNotified: NotifiedCheckups = {};
  const scheduled: LocalNotificationSchema[] = [];
  const now = new Date();

  for (const person of people) {
    if (!person.birthday) continue;
    const occurrence = nextOccurrence(person.birthday, now);
    const daysAway = daysUntilBirthday(person.birthday, now);
    if (!occurrence || daysAway === null || daysAway > BIRTHDAY_LOOKAHEAD_DAYS) continue;

    const key = toDateKey(occurrence);
    const fireAt = birthdayFireAt(occurrence, prefs.birthdayReminderTime);
    /* Guard on the moment it was due to fire, not on "is it today": on the birthday itself, before
       the chosen time, nothing has been announced yet and a mutation must not consume the alarm. */
    const passed = fireAt.getTime() <= now.getTime();
    if (passed) nextNotified[person.id] = key;

    let at = fireAt;
    if (passed) {
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
 * The fixed-id nudge for the next candidate day (today if the chosen time hasn't passed yet,
 * otherwise tomorrow). Returns nothing once that day already has an entry, which lets the
 * reconcile cancel it. Idempotent by design — no overdue-cycle tracking needed since the id's
 * meaning simply shifts forward each day.
 *
 * Quiet hours deliberately don't apply: this is a time the user picked, and deferring it with a
 * window they also picked would be one setting overruling another.
 */
async function collectDailyReminder(prefs: Preferences): Promise<LocalNotificationSchema[]> {
  if (!prefs.dailyReminder) return [];

  const candidate = nextDailyReminderAt(new Date(), prefs.dailyReminderTime);
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
  // Read once, so all three collectors see the same snapshot even if a preference changes mid-pass.
  const prefs = getPreferences();
  const [checkups, birthdays, daily] = await Promise.all([
    collectCheckupNotifications(people, prefs),
    collectBirthdayNotifications(people, prefs),
    collectDailyReminder(prefs),
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

/* Reconciles run strictly one at a time. Two overlapping passes would each read `notifiedCheckups`
   before the other wrote it, and each would cancel every pending id the *other* had just scheduled
   between its own schedule and cancel steps. Nothing triggered a second pass mid-flight while every
   call site was fire-and-forget from the UI thread, but a background-fetch wake-up lands on top of
   whatever the app was already doing, so the ordering has to be explicit. */
let reconcileChain: Promise<void> = Promise.resolve();

/** Awaitable refresh — resolves once *this* caller's reconcile has finished (any earlier queued
    pass included). Background work must use this: the OS closes the wake-up window as soon as the
    task reports done, and a half-written schedule is worse than none. */
export function refreshNotificationsNow(): Promise<void> {
  if (!isNative) return Promise.resolve();
  reconcileChain = reconcileChain.then(() =>
    reconcileNotifications().catch((err) => console.warn('notifications: refresh failed', err)),
  );
  return reconcileChain;
}

/** Fire-and-forget refresh; safe to call from any mutation/sync/resume path. */
export function refreshNotifications(): void {
  void refreshNotificationsNow();
}

/**
 * Call once at app bootstrap. Arms whatever reminders the data already justifies — and asks for
 * nothing.
 *
 * The display permission (POST_NOTIFICATIONS on Android 13+) used to be requested from right here.
 * The reasoning that kept exact alarms out of this function applies word for word to it: doing so
 * unannounced on first launch, before the user has seen a diary let alone a reminder, is
 * startling. And on a fresh install the dialog cannot even be about anything — all three reminder
 * kinds need data that doesn't exist yet, since checkups and birthdays need people and the daily
 * nudge needs a writing habit to interrupt. The denial is stickier than the exact-alarm one, too:
 * Android stops showing the dialog after two dismissals, after which Settings can only display the
 * "blocked" copy and hand the user off to system settings.
 *
 * So the ask moved to the moments where the reason is on screen — see requestPermissionFor, called
 * when a person is saved with a checkup interval or a birthday, and when the diary has enough
 * entries for the daily nudge to be interrupting something. Settings keeps its explicit button for
 * anyone who wants to turn reminders on before any of that happens.
 */
export async function initLocalNotifications(): Promise<void> {
  if (!isNative) return;
  refreshNotifications();
}

/** Entries that must already exist before the daily nudge is allowed to ask. The nudge interrupts
    a habit; below this there is no habit yet, and the prompt would be about nothing. */
const DAILY_HABIT_ENTRIES = 3;

/**
 * Ask for the notification permission, but only where it would mean something.
 *
 * Silent (and cheap) in every case where the dialog would be noise: not on the web, not when the
 * user has that kind of reminder switched off, not when the permission has already been decided
 * either way — and, for the daily nudge, not until the diary is actually being written in.
 * Fire-and-forget from call sites; the reconcile it ends with picks up whatever was just saved.
 */
export async function requestPermissionFor(kind: 'checkup' | 'birthday' | 'daily'): Promise<void> {
  if (!isNative) return;
  const prefs = getPreferences();
  const enabledForKind =
    kind === 'checkup'
      ? prefs.checkupReminders
      : kind === 'birthday'
        ? prefs.birthdayReminders
        : prefs.dailyReminder;
  if (!enabledForKind) return;
  // 'denied' is as final as 'granted' here: Android stops presenting the dialog, so asking again
  // spends nothing and tells the user nothing. Settings' own button covers changing their mind.
  if ((await getNotificationPermission()) !== 'prompt') return;
  if (kind === 'daily' && (await db.entries.count()) < DAILY_HABIT_ENTRIES) return;
  await LocalNotifications.requestPermissions();
  refreshNotifications();
}

/* The Settings page asks about permissions through these rather than importing the plugin itself —
   this module owns every call into it, which is what keeps the web build free of it entirely. */

export async function getNotificationPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!isNative) return 'granted';
  const { display } = await LocalNotifications.checkPermissions();
  return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';
}

export async function requestNotificationPermission(): Promise<void> {
  if (!isNative) return;
  await LocalNotifications.requestPermissions();
}

/** 'unsupported' covers pre-Android-12 and plugin builds without the exact-alarm API, where there
    is nothing for the user to grant and so nothing worth showing them. */
export async function getExactAlarmStatus(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!isNative) return 'unsupported';
  try {
    const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting();
    return exact_alarm === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/** Opens the Android exact-alarm settings screen. Only ever called from a button press. */
export async function requestExactAlarms(): Promise<void> {
  if (!isNative) return;
  try {
    await LocalNotifications.changeExactNotificationSetting();
  } catch {
    // Nothing to open on this Android version; the caller's status check already said so.
  }
}
