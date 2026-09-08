import { describe, expect, it } from 'vitest';
import {
  configAt,
  defaultSchedule,
  habitAppliesOn,
  habitCreatedBy,
  habitOccursOn,
  scheduleAt,
  type Habit,
} from './model';

/* The calendar view's denominator: which habits count toward a given day at all. Get this wrong in
   either direction and every other day's ratio is wrong with it — a habit created last week showing
   up as "missed" throughout last month, or a retired one still dragging a completion percentage down
   for a year after it stopped being asked about. */

const habit = (patch: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Push-ups',
  type: 'binary',
  since: '2026-03-01',
  revisions: [],
  order: 0,
  archivedAt: null,
  ...patch,
});

describe('habitAppliesOn', () => {
  it('does not apply before the habit existed', () => {
    expect(habitAppliesOn(habit({ since: '2026-03-01' }), '2026-02-28')).toBe(false);
  });

  it('applies from the day it was created', () => {
    expect(habitAppliesOn(habit({ since: '2026-03-01' }), '2026-03-01')).toBe(true);
    expect(habitAppliesOn(habit({ since: '2026-03-01' }), '2026-06-01')).toBe(true);
  });

  it('reaches back through an edit to the earliest banked revision, not just `since`', () => {
    // `since` moved to March when the habit was renamed, but it was really created in January —
    // the same trail configAt reads to find what the goal was, read here to find when it started.
    const edited = habit({
      since: '2026-03-01',
      revisions: [{ since: '2026-01-15', changedAt: '2026-03-01T09:00:00.000Z', name: 'Sit-ups' }],
    });
    expect(habitAppliesOn(edited, '2026-02-01')).toBe(true);
    expect(habitAppliesOn(edited, '2026-01-01')).toBe(false);
  });

  it('always applies for a legacy habit with no recorded history', () => {
    // since: '' is configAt's convention for "always was this config" — habitAppliesOn treats it
    // the same way, rather than excluding every day before edit-tracking existed.
    expect(habitAppliesOn(habit({ since: '', revisions: [] }), '2020-01-01')).toBe(true);
  });

  it('stops applying the day after it was archived', () => {
    const archived = habit({ archivedAt: '2026-06-15T18:00:00.000Z' });
    expect(habitAppliesOn(archived, '2026-06-16')).toBe(false);
  });

  it('still applies on the day it was archived — it was live for most of it', () => {
    const archived = habit({ archivedAt: '2026-06-15T18:00:00.000Z' });
    expect(habitAppliesOn(archived, '2026-06-15')).toBe(true);
  });

  it('applies on every day while not archived', () => {
    expect(habitAppliesOn(habit({ archivedAt: null }), '2099-01-01')).toBe(true);
  });
});

describe('habitCreatedBy', () => {
  it('agrees with habitAppliesOn for a habit that has never been archived', () => {
    const h = habit({ since: '2026-03-01' });
    expect(habitCreatedBy(h, '2026-02-28')).toBe(false);
    expect(habitCreatedBy(h, '2026-03-01')).toBe(true);
  });

  it('unlike habitAppliesOn, keeps saying true after the habit is archived', () => {
    // The distinction the day card needs: a habit retired before this day still existed once, so
    // the card should say "every habit is retired" rather than pretending nothing was ever here.
    const archived = habit({ since: '2026-01-01', archivedAt: '2026-06-01T00:00:00.000Z' });
    expect(habitAppliesOn(archived, '2026-08-01')).toBe(false);
    expect(habitCreatedBy(archived, '2026-08-01')).toBe(true);
  });
});

describe('scheduleAt', () => {
  it('reads a habit with no schedule as daily and a task with none as once', () => {
    // The one place the two axes meet. Every habit written before schedules existed was daily, so
    // no stored row had to change; a task with nothing said about it is a chore you do once.
    expect(scheduleAt(habit())).toEqual({ kind: 'daily' });
    expect(scheduleAt(habit({ type: 'task' }))).toEqual({ kind: 'once' });
    expect(defaultSchedule('mood')).toEqual({ kind: 'daily' });
  });

  it('resolves the schedule that was in force on the day, not today’s', () => {
    /* The whole point of keeping the schedule in the config: narrowing a habit to Mondays must not
       retroactively excuse every Saturday it was genuinely missed on — the same rule that stops a
       raised goal repainting the grid. */
    const narrowed = habit({
      since: '2026-06-01',
      schedule: { kind: 'weekdays', days: [1] },
      revisions: [
        {
          since: '2026-01-01',
          changedAt: '2026-06-01T09:00:00.000Z',
          name: 'Push-ups',
          schedule: { kind: 'daily' },
        },
      ],
    });
    expect(scheduleAt(narrowed, '2026-03-01')).toEqual({ kind: 'daily' });
    expect(scheduleAt(narrowed, '2026-07-01')).toEqual({ kind: 'weekdays', days: [1] });
    // And the rest of the configuration still travels with it.
    expect(configAt(narrowed, '2026-03-01').name).toBe('Push-ups');
  });
});

describe('habitOccursOn', () => {
  // 2026-09-07 is a Monday, 2026-09-08 a Tuesday.
  const mondays = habit({ since: '2026-01-01', schedule: { kind: 'weekdays', days: [1] } });

  it('asks only on the scheduled days', () => {
    expect(habitOccursOn(mondays, '2026-09-07')).toBe(true);
    expect(habitOccursOn(mondays, '2026-09-08')).toBe(false);
  });

  it('still refuses a day before the habit existed or after it was retired', () => {
    // The schedule narrows `habitAppliesOn`; it never widens it.
    const late = habit({ since: '2026-09-14', schedule: { kind: 'weekdays', days: [1] } });
    expect(habitOccursOn(late, '2026-09-07')).toBe(false);

    const retired = habit({
      since: '2026-01-01',
      schedule: { kind: 'weekdays', days: [1] },
      archivedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(habitOccursOn(retired, '2026-09-07')).toBe(false);
  });

  it('anchors an interval on the habit’s origin, reached through its revisions', () => {
    // The same trail `habitCreatedBy` reads, so a rename can never shift which days a habit
    // falls on — an anchor that moved would rewrite the schedule backwards.
    const edited = habit({
      since: '2026-03-01',
      schedule: { kind: 'interval', every: 3 },
      revisions: [{ since: '2026-01-01', changedAt: '2026-03-01T09:00:00.000Z', name: 'Water' }],
    });
    /* 1 March is 59 days after the origin and 59 is not a multiple of 3, so the 2nd is the
       occurrence and the 1st is not. Anchored on `since` instead, it would be exactly the other
       way round — which is what makes this assertion worth making. */
    expect(habitOccursOn(edited, '2026-03-02')).toBe(true);
    expect(habitOccursOn(edited, '2026-03-01')).toBe(false);
  });
});
