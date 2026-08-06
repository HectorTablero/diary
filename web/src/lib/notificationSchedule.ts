import { addDays, set } from 'date-fns';

/**
 * The time arithmetic behind the reminders, kept apart from lib/notifications.ts because that file
 * imports the Capacitor plugin at module scope and so cannot be unit-tested — the same reason
 * birthday.ts has a test file and notifications.ts does not.
 *
 * Everything here works in the device's local time. There is no timezone anywhere in this app, and
 * a reminder only ever means anything relative to the clock of the device that shows it.
 */

export interface TimeOfDay {
  hours: number;
  minutes: number;
}

/**
 * `HH:mm` → hours and minutes, falling back rather than throwing.
 *
 * Deliberately tolerant: the value comes from localStorage, which another tab, an older build or a
 * corrupt profile can put anything into, and a bad string must not be able to stop the whole
 * reconcile — losing every alarm is far worse than one being at the wrong minute.
 */
export function parseTimeOfDay(value: string, fallback: TimeOfDay = { hours: 9, minutes: 0 }): TimeOfDay {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return { hours, minutes };
}

export const formatTimeOfDay = ({ hours, minutes }: TimeOfDay): string =>
  `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

/** That clock time on that calendar day. */
export const atTimeOfDay = (day: Date, time: string): Date =>
  set(day, { ...parseTimeOfDay(time), seconds: 0, milliseconds: 0 });

/**
 * The next moment the daily nudge should fire: today if that time hasn't passed, else tomorrow.
 *
 * addDays rather than +86_400_000 — a daily alarm crosses a DST boundary twice a year, and adding
 * a fixed number of milliseconds would shift it by an hour and keep it shifted.
 */
export function nextDailyReminderAt(now: Date, time: string): Date {
  const candidate = atTimeOfDay(now, time);
  return candidate > now ? candidate : atTimeOfDay(addDays(now, 1), time);
}

/**
 * When a birthday reminder should fire: on the day itself, at `time`.
 *
 * There is deliberately no way to ask for it some days early. An early reminder has to say "this
 * is coming" rather than "this is today", which is a second notification with its own wording, its
 * own catch-up rules and its own re-announcement guard — a lot of machinery for a nudge whose
 * useful version is the one that arrives on the morning.
 */
export const birthdayFireAt = (occurrence: Date, time: string): Date => atTimeOfDay(occurrence, time);

/**
 * Whether `at` falls inside the quiet window.
 *
 * The window normally wraps midnight (22:30 → 08:00), which is why this compares minute-of-day
 * rather than dates, and why the wrapped case is an OR instead of an AND. A start equal to the end
 * is treated as no window at all rather than as "always quiet" — the latter would silence
 * everything, which is never what someone setting two identical times meant.
 */
export function isWithinQuietHours(at: Date, start: string, end: string): boolean {
  const minutes = at.getHours() * 60 + at.getMinutes();
  const from = parseTimeOfDay(start, { hours: 22, minutes: 30 });
  const until = parseTimeOfDay(end, { hours: 8, minutes: 0 });
  const fromMinutes = from.hours * 60 + from.minutes;
  const untilMinutes = until.hours * 60 + until.minutes;

  if (fromMinutes === untilMinutes) return false;
  return fromMinutes < untilMinutes
    ? minutes >= fromMinutes && minutes < untilMinutes
    : minutes >= fromMinutes || minutes < untilMinutes;
}

/**
 * `at`, or the end of the quiet window if `at` falls inside it.
 *
 * This is applied only to reminders whose time the user did not choose — a checkup catch-up, or a
 * checkup alarm whose minute was inherited from whenever the checkup last happened to be marked
 * done. It is deliberately *not* applied to the daily nudge or an on-time birthday: silencing an
 * alarm the user set for 23:45 using a window they also set would be one setting quietly overruling
 * another. That restriction is what makes quiet hours safe to have on by default.
 */
export function nextWakingTime(at: Date, start: string, end: string): Date {
  if (!isWithinQuietHours(at, start, end)) return at;

  const until = parseTimeOfDay(end, { hours: 8, minutes: 0 });
  const sameDay = set(at, { ...until, seconds: 0, milliseconds: 0 });
  // Landing before the window's end on the same day means the window opened yesterday evening and
  // we are in its small hours; landing after means it opened tonight and the end is tomorrow's.
  return sameDay > at ? sameDay : atTimeOfDay(addDays(at, 1), end);
}
