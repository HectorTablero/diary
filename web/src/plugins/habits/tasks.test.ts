import { describe, expect, it } from 'vitest';
import type { Habit } from './model';
import type { HabitSchedule } from './schedule';
import { pendingTask } from './tasks';

/* What makes a task a task: its question outlives the day it was asked on. Every assertion here is
   about a *day other than the one being answered*, which is the one thing no other kind in this
   plugin does — and the one thing that, got wrong, either nags forever or forgets silently. */

const task = (schedule?: HabitSchedule, patch: Partial<Habit> = {}): Habit => ({
  id: 't1',
  name: 'Renew the passport',
  type: 'task',
  since: '2026-09-01',
  revisions: [],
  order: 0,
  archivedAt: null,
  schedule,
  ...patch,
});

const done = (...keys: string[]) => new Set(keys);

describe('pendingTask — a one-off task', () => {
  it('is due, not overdue, on the day it was created', () => {
    expect(pendingTask(task(), '2026-09-01', done())).toEqual({
      dueOn: '2026-09-01',
      overdue: false,
    });
  });

  it('carries over to the following days as overdue', () => {
    expect(pendingTask(task(), '2026-09-04', done())).toEqual({
      dueOn: '2026-09-01',
      overdue: true,
    });
  });

  it('names the day it was owed from, not the day it is being read on', () => {
    // The pill says "overdue since the 1st" three days running rather than "overdue since
    // yesterday" — how long it has been waiting is the part worth knowing.
    expect(pendingTask(task(), '2026-09-30', done())?.dueOn).toBe('2026-09-01');
  });

  it('stops asking once it has been done', () => {
    expect(pendingTask(task(), '2026-09-05', done('2026-09-03'))).toBeUndefined();
  });

  it('still names its due day on the day it is finally done', () => {
    /* Today's own tick is deliberately not consulted, so the row does not reshape itself under the
       finger that just pressed it — the same reason `streakBefore` stops at yesterday. */
    expect(pendingTask(task(), '2026-09-04', done('2026-09-04'))).toEqual({
      dueOn: '2026-09-01',
      overdue: true,
    });
  });

  it('is not owed before it existed', () => {
    expect(pendingTask(task(), '2026-08-31', done())).toBeUndefined();
  });

  it('stops nagging past the carry window', () => {
    // Bounded rather than open-ended: a chore entered eighteen months ago should not mark every
    // day since as a miss, and the window is the one the day page already reads.
    expect(pendingTask(task(), '2027-06-01', done())).toBeUndefined();
  });

  it('is not owed by a task that has been retired', () => {
    const retired = task(undefined, { archivedAt: '2026-09-02T10:00:00.000Z' });
    expect(pendingTask(retired, '2026-09-10', done())).toBeUndefined();
  });
});

describe('pendingTask — a repeating task', () => {
  const weekly: HabitSchedule = { kind: 'weekdays', days: [1] }; // Mondays
  // 2026-09-07 and 2026-09-14 are Mondays.

  it('is due on each occurrence', () => {
    expect(pendingTask(task(weekly), '2026-09-07', done())).toEqual({
      dueOn: '2026-09-07',
      overdue: false,
    });
  });

  it('carries a missed occurrence into the days after it', () => {
    expect(pendingTask(task(weekly), '2026-09-09', done())).toEqual({
      dueOn: '2026-09-07',
      overdue: true,
    });
  });

  it('names the oldest unanswered occurrence once two have gone by', () => {
    /* Not a queue. Two missed Mondays are one thing still to do — you do the washing up once,
       however many days you let it pile up — so the older one is what is named and one completion
       will clear both. */
    expect(pendingTask(task(weekly), '2026-09-15', done())).toEqual({
      dueOn: '2026-09-07',
      overdue: true,
    });
  });

  it('clears everything behind a completion', () => {
    expect(pendingTask(task(weekly), '2026-09-09', done('2026-09-08'))).toBeUndefined();
  });

  it('comes back on the next occurrence after being done', () => {
    expect(pendingTask(task(weekly), '2026-09-14', done('2026-09-07'))).toEqual({
      dueOn: '2026-09-14',
      overdue: false,
    });
  });

  it('does not reach back past its own origin', () => {
    // The habit was created on a Tuesday, so the Monday before it is not an occurrence it missed.
    const created = task(weekly, { since: '2026-09-08', revisions: [] });
    expect(pendingTask(created, '2026-09-10', done())).toBeUndefined();
  });
});

describe('pendingTask — every other kind', () => {
  it('never owes anything', () => {
    // Half of twenty push-ups is not an outstanding ten, and yesterday's mood is not a question
    // today can still answer. Asking unconditionally is what keeps the four surfaces branch-free.
    const habit = task(undefined, { type: 'binary' });
    expect(pendingTask(habit, '2026-09-10', done())).toBeUndefined();
  });
});
