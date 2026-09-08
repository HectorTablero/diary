import { describe, expect, it } from 'vitest';
import { occursOn, sameSchedule, scheduleSchema, type HabitSchedule } from './schedule';

/* Which days a habit's question is put on. Every surface in the plugin — the day card, the streak
   walk, the calendar's denominator, the widget, the reminder — narrows itself through this one
   function, so an off-by-one here is an off-by-one in five places at once, and in four of them it
   would look like the *data* being wrong rather than the calendar arithmetic. */

/* 2026-09-06 is a Sunday, so 2026-09-07 is a Monday and 2026-09-09 a Wednesday. Anchoring the
   weekday cases on a stated fact rather than on `getDay` keeps the test honest about what it is
   asserting: these dates were checked against a calendar, not against the implementation. */
const SUNDAY = '2026-09-06';
const MONDAY = '2026-09-07';
const WEDNESDAY = '2026-09-09';

describe('occursOn — daily', () => {
  it('falls on every day', () => {
    expect(occursOn({ kind: 'daily' }, SUNDAY, '2026-01-01')).toBe(true);
    expect(occursOn({ kind: 'daily' }, '2099-12-31', '2026-01-01')).toBe(true);
  });
});

describe('occursOn — once', () => {
  it('falls only on the habit’s origin', () => {
    expect(occursOn({ kind: 'once' }, '2026-09-01', '2026-09-01')).toBe(true);
    expect(occursOn({ kind: 'once' }, '2026-09-02', '2026-09-01')).toBe(false);
    expect(occursOn({ kind: 'once' }, '2026-08-31', '2026-09-01')).toBe(false);
  });

  it('falls on every day when there is no origin to anchor it to', () => {
    /* A row written before edits were tracked has `since: ''`. A task that vanished entirely
       because its one day could not be located is worse than one that keeps asking. */
    expect(occursOn({ kind: 'once' }, '2026-09-02', '')).toBe(true);
  });
});

describe('occursOn — weekdays', () => {
  const monWedFri: HabitSchedule = { kind: 'weekdays', days: [1, 3, 5] };

  it('falls on the chosen days and not the others', () => {
    expect(occursOn(monWedFri, MONDAY, '2026-01-01')).toBe(true);
    expect(occursOn(monWedFri, WEDNESDAY, '2026-01-01')).toBe(true);
    expect(occursOn(monWedFri, SUNDAY, '2026-01-01')).toBe(false);
  });

  it('treats 0 as Sunday, matching getDay and weekdayName', () => {
    expect(occursOn({ kind: 'weekdays', days: [0] }, SUNDAY, '2026-01-01')).toBe(true);
    expect(occursOn({ kind: 'weekdays', days: [0] }, MONDAY, '2026-01-01')).toBe(false);
  });

  it('ignores the origin — a weekday is a weekday whenever the habit started', () => {
    expect(occursOn(monWedFri, MONDAY, '2099-01-01')).toBe(true);
  });
});

describe('occursOn — monthly', () => {
  it('falls on the chosen date each month', () => {
    expect(occursOn({ kind: 'monthly', day: 15 }, '2026-09-15', '2026-01-01')).toBe(true);
    expect(occursOn({ kind: 'monthly', day: 15 }, '2026-10-15', '2026-01-01')).toBe(true);
    expect(occursOn({ kind: 'monthly', day: 15 }, '2026-09-14', '2026-01-01')).toBe(false);
  });

  it('lands on the last day of a month too short to hold it', () => {
    /* The commonest reason to pick 31 is "the last day of the month". Skipping February entirely
       would make that choice wrong eleven times a year, and silently. */
    expect(occursOn({ kind: 'monthly', day: 31 }, '2026-02-28', '2026-01-01')).toBe(true);
    expect(occursOn({ kind: 'monthly', day: 31 }, '2026-04-30', '2026-01-01')).toBe(true);
    expect(occursOn({ kind: 'monthly', day: 31 }, '2026-03-31', '2026-01-01')).toBe(true);
  });

  it('does not double up inside a month it does fit in', () => {
    expect(occursOn({ kind: 'monthly', day: 31 }, '2026-03-30', '2026-01-01')).toBe(false);
  });

  it('handles a leap year’s February', () => {
    expect(occursOn({ kind: 'monthly', day: 30 }, '2028-02-29', '2026-01-01')).toBe(true);
    expect(occursOn({ kind: 'monthly', day: 30 }, '2026-02-29', '2026-01-01')).toBe(false); // no such day
  });
});

describe('occursOn — interval', () => {
  it('counts from the origin', () => {
    const every3: HabitSchedule = { kind: 'interval', every: 3 };
    expect(occursOn(every3, '2026-09-01', '2026-09-01')).toBe(true);
    expect(occursOn(every3, '2026-09-02', '2026-09-01')).toBe(false);
    expect(occursOn(every3, '2026-09-04', '2026-09-01')).toBe(true);
    expect(occursOn(every3, '2026-09-07', '2026-09-01')).toBe(true);
  });

  it('never falls before the origin', () => {
    expect(occursOn({ kind: 'interval', every: 3 }, '2026-08-29', '2026-09-01')).toBe(false);
  });

  it('counts calendar days across a DST boundary rather than 24-hour blocks', () => {
    /* `differenceInCalendarDays` on local dates, for the reason `streakBefore` walks with
       `addDays`: on a spring-forward date a millisecond arithmetic would land an hour short and
       shift every occurrence after it by one. */
    const every7: HabitSchedule = { kind: 'interval', every: 7 };
    expect(occursOn(every7, '2026-03-30', '2026-03-23')).toBe(true);
    expect(occursOn(every7, '2026-11-02', '2026-10-26')).toBe(true);
  });

  it('falls back to every day with no origin to anchor it to', () => {
    expect(occursOn({ kind: 'interval', every: 3 }, '2026-09-02', '')).toBe(true);
  });
});

describe('sameSchedule', () => {
  it('compares weekday sets by content, not by identity', () => {
    expect(
      sameSchedule({ kind: 'weekdays', days: [1, 3] }, { kind: 'weekdays', days: [1, 3] }),
    ).toBe(true);
    expect(
      sameSchedule({ kind: 'weekdays', days: [1, 3] }, { kind: 'weekdays', days: [1, 4] }),
    ).toBe(false);
  });

  it('separates the shapes', () => {
    expect(sameSchedule({ kind: 'daily' }, { kind: 'once' })).toBe(false);
    expect(sameSchedule({ kind: 'monthly', day: 1 }, { kind: 'monthly', day: 2 })).toBe(false);
    expect(sameSchedule({ kind: 'interval', every: 2 }, { kind: 'interval', every: 3 })).toBe(
      false,
    );
  });

  it('treats two absent schedules as equal and an absent one as different from any', () => {
    // What keeps `configChanged` from banking a revision for an edit that changed nothing, while
    // still noticing the first time a habit is given a schedule at all.
    expect(sameSchedule(undefined, undefined)).toBe(true);
    expect(sameSchedule(undefined, { kind: 'daily' })).toBe(false);
  });
});

describe('scheduleSchema', () => {
  it('reads a stored schedule back', () => {
    expect(scheduleSchema.parse({ kind: 'monthly', day: 15 })).toEqual({
      kind: 'monthly',
      day: 15,
    });
  });

  it('sorts and deduplicates weekdays, so two rows meaning one week compare equal', () => {
    expect(scheduleSchema.parse({ kind: 'weekdays', days: [5, 1, 5, 3] })).toEqual({
      kind: 'weekdays',
      days: [1, 3, 5],
    });
  });

  it('reads a malformed or unknown schedule as absent rather than failing the habit', () => {
    // The same posture `kindSchema` takes: a row from a future build should leave the habit
    // working, not remove it from the list.
    expect(scheduleSchema.parse({ kind: 'fortnightly' })).toBeUndefined();
    expect(scheduleSchema.parse({ kind: 'weekdays', days: [] })).toBeUndefined();
    expect(scheduleSchema.parse({ kind: 'interval', every: 1 })).toBeUndefined();
    expect(scheduleSchema.parse({ kind: 'monthly', day: 32 })).toBeUndefined();
    expect(scheduleSchema.parse(undefined)).toBeUndefined();
  });
});
