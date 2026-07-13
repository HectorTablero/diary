import { BIRTHDAY_REGEX } from '@diary/shared';

/* Birthdays are stored as `YYYY-MM-DD`, or `--MM-DD` when the year is unknown — phone contacts
   very often omit it, so nothing here may assume a year exists. */

export interface ParsedBirthday {
  /** `null` when the contact only recorded a day and month. */
  year: number | null;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

const PARTS = /^(\d{4}|--)-(\d{2})-(\d{2})$/;

export function parseBirthday(value: string | null | undefined): ParsedBirthday | null {
  if (!value || !BIRTHDAY_REGEX.test(value)) return null;
  const match = PARTS.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return {
    year: year === '--' ? null : Number(year),
    month: Number(month),
    day: Number(day),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatBirthdayValue(year: number | null, month: number, day: number): string {
  return `${year === null ? '--' : String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

/** Build the storage value from an `<input type="date">` (which always carries a year). */
export const birthdayFromDateInput = (value: string, withYear: boolean): string | null => {
  const parsed = parseBirthday(value);
  if (!parsed) return null;
  return formatBirthdayValue(withYear ? parsed.year : null, parsed.month, parsed.day);
};

/** An `<input type="date">` needs a real year; use a leap year so Feb 29 stays selectable. */
export const birthdayToDateInput = (value: string | null): string => {
  const parsed = parseBirthday(value);
  if (!parsed) return '';
  return formatBirthdayValue(parsed.year ?? 2000, parsed.month, parsed.day);
};

/** Age on `on`, or `null` when the year is unknown. */
export function ageOn(birthday: string | null, on: Date = new Date()): number | null {
  const parsed = parseBirthday(birthday);
  if (!parsed || parsed.year === null) return null;
  let age = on.getFullYear() - parsed.year;
  const monthDiff = on.getMonth() + 1 - parsed.month;
  if (monthDiff < 0 || (monthDiff === 0 && on.getDate() < parsed.day)) age--;
  return age < 0 ? null : age;
}

/**
 * The next date this birthday falls on, at `hour` local time. **Today counts** — day granularity,
 * not hour — so a birthday discovered at 10:00 still reports as today rather than jumping a year;
 * scheduling the (past) 09:00 alarm is the caller's problem to catch up on, exactly as
 * refreshCheckupNotifications does.
 *
 * Feb 29 in a non-leap year falls back to Feb 28, so the reminder doesn't silently vanish for
 * three years at a time.
 */
export function nextOccurrence(
  birthday: string | null,
  from: Date = new Date(),
  hour = 9,
): Date | null {
  const parsed = parseBirthday(birthday);
  if (!parsed) return null;

  const at = (year: number): Date => {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const day = parsed.month === 2 && parsed.day === 29 && !isLeap ? 28 : parsed.day;
    return new Date(year, parsed.month - 1, day, hour, 0, 0, 0);
  };

  const thisYear = at(from.getFullYear());
  const startOfToday = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const isTodayOrLater =
    new Date(thisYear.getFullYear(), thisYear.getMonth(), thisYear.getDate()).getTime() >=
    startOfToday;
  return isTodayOrLater ? thisYear : at(from.getFullYear() + 1);
}

/** Whole days until the next birthday (0 = today). */
export function daysUntilBirthday(birthday: string | null, from: Date = new Date()): number | null {
  const next = nextOccurrence(birthday, from);
  if (!next) return null;
  const startOfToday = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const startOfNext = new Date(next.getFullYear(), next.getMonth(), next.getDate()).getTime();
  return Math.round((startOfNext - startOfToday) / 86_400_000);
}

/** e.g. "13 July 1990" — or "13 July" when the year is unknown. */
export function formatBirthday(birthday: string | null, locale: string): string {
  const parsed = parseBirthday(birthday);
  if (!parsed) return '';
  const date = new Date(parsed.year ?? 2000, parsed.month - 1, parsed.day);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    ...(parsed.year !== null && { year: 'numeric' }),
  }).format(date);
}
