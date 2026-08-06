import { describe, expect, it } from 'vitest';
import {
  atTimeOfDay,
  birthdayFireAt,
  isWithinQuietHours,
  nextDailyReminderAt,
  nextWakingTime,
  parseTimeOfDay,
} from './notificationSchedule';

/** Local time throughout — the whole module works in the device's clock, so the tests must too. */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

describe('parseTimeOfDay', () => {
  it('reads HH:mm', () => {
    expect(parseTimeOfDay('23:45')).toEqual({ hours: 23, minutes: 45 });
    expect(parseTimeOfDay('09:00')).toEqual({ hours: 9, minutes: 0 });
    expect(parseTimeOfDay('9:05')).toEqual({ hours: 9, minutes: 5 });
  });

  // A value out of localStorage can be anything; falling back beats throwing, because throwing here
  // would abort the reconcile and lose every alarm, not just this one.
  it('falls back on anything unparseable or out of range', () => {
    const fallback = { hours: 7, minutes: 30 };
    for (const bad of ['', 'nope', '24:00', '12:60', '12', '12:5', '-1:00']) {
      expect(parseTimeOfDay(bad, fallback)).toEqual(fallback);
    }
  });
});

describe('nextDailyReminderAt', () => {
  it('uses today when the time is still ahead', () => {
    expect(nextDailyReminderAt(at(2026, 3, 10, 18, 0), '23:45')).toEqual(at(2026, 3, 10, 23, 45));
  });

  it('rolls to tomorrow once the time has passed', () => {
    expect(nextDailyReminderAt(at(2026, 3, 10, 23, 50), '23:45')).toEqual(at(2026, 3, 11, 23, 45));
  });

  it('rolls across a month boundary', () => {
    expect(nextDailyReminderAt(at(2026, 3, 31, 23, 50), '23:45')).toEqual(at(2026, 4, 1, 23, 45));
  });

  // Exactly on the minute counts as passed, so the reminder is never scheduled for "now" — which
  // would fire immediately on any reconcile that happened to land on the same minute.
  it('treats the exact time as passed', () => {
    expect(nextDailyReminderAt(at(2026, 3, 10, 23, 45), '23:45')).toEqual(at(2026, 3, 11, 23, 45));
  });
});

describe('birthdayFireAt', () => {
  it('fires on the day itself, at the chosen time', () => {
    expect(birthdayFireAt(at(2026, 7, 13), '09:00')).toEqual(at(2026, 7, 13, 9, 0));
  });

  it('keeps the day when the occurrence already carries a time of its own', () => {
    expect(birthdayFireAt(at(2026, 7, 13, 23, 30), '08:30')).toEqual(at(2026, 7, 13, 8, 30));
  });

  it('falls back to 09:00 on an unparseable time rather than losing the alarm', () => {
    expect(birthdayFireAt(at(2026, 7, 13), 'nonsense')).toEqual(at(2026, 7, 13, 9, 0));
  });
});

describe('isWithinQuietHours', () => {
  const start = '22:30';
  const end = '08:00';

  it('covers both sides of midnight for a wrapping window', () => {
    expect(isWithinQuietHours(at(2026, 3, 10, 23, 0), start, end)).toBe(true);
    expect(isWithinQuietHours(at(2026, 3, 10, 3, 0), start, end)).toBe(true);
  });

  it('is false in the middle of the day', () => {
    expect(isWithinQuietHours(at(2026, 3, 10, 14, 0), start, end)).toBe(false);
  });

  // Half-open on purpose: the window includes its start and excludes its end, so nextWakingTime's
  // answer is itself outside the window and can't bounce.
  it('includes the start minute and excludes the end minute', () => {
    expect(isWithinQuietHours(at(2026, 3, 10, 22, 30), start, end)).toBe(true);
    expect(isWithinQuietHours(at(2026, 3, 10, 8, 0), start, end)).toBe(false);
  });

  it('handles a window that does not wrap', () => {
    expect(isWithinQuietHours(at(2026, 3, 10, 10, 0), '09:00', '17:00')).toBe(true);
    expect(isWithinQuietHours(at(2026, 3, 10, 20, 0), '09:00', '17:00')).toBe(false);
  });

  it('treats an empty window as no window at all', () => {
    expect(isWithinQuietHours(at(2026, 3, 10, 4, 0), '08:00', '08:00')).toBe(false);
  });
});

describe('nextWakingTime', () => {
  const start = '22:30';
  const end = '08:00';

  it('leaves a time outside the window alone', () => {
    const outside = at(2026, 3, 10, 14, 0);
    expect(nextWakingTime(outside, start, end)).toEqual(outside);
  });

  it('snaps a small-hours time forward to this morning', () => {
    expect(nextWakingTime(at(2026, 3, 10, 3, 12), start, end)).toEqual(at(2026, 3, 10, 8, 0));
  });

  it('snaps a late-evening time forward to tomorrow morning', () => {
    expect(nextWakingTime(at(2026, 3, 10, 23, 30), start, end)).toEqual(at(2026, 3, 11, 8, 0));
  });

  it('crosses a month boundary when snapping forward', () => {
    expect(nextWakingTime(at(2026, 3, 31, 23, 30), start, end)).toEqual(at(2026, 4, 1, 8, 0));
  });

  it('produces a time that is itself outside the window', () => {
    const snapped = nextWakingTime(at(2026, 3, 10, 2, 0), start, end);
    expect(isWithinQuietHours(snapped, start, end)).toBe(false);
  });
});

describe('atTimeOfDay', () => {
  it('keeps the day and replaces the clock time', () => {
    expect(atTimeOfDay(at(2026, 3, 10, 17, 22), '06:05')).toEqual(at(2026, 3, 10, 6, 5));
  });
});
