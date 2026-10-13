import { describe, expect, it } from 'vitest';
import { bucketize, habitLifetime, pickGrain, streakRuns } from './chart';
import type { Habit } from './model';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h',
  name: 'Push-ups',
  type: 'numeric',
  target: 100,
  since: '2024-01-03',
  revisions: [{ since: '2024-01-01', changedAt: '', name: 'Push-ups', target: 50 }],
  order: 0,
  archivedAt: null,
  ...over,
});

const history = new Map([
  ['2024-01-01', { h: 50 }],
  ['2024-01-04', { h: 60 }],
]);

describe('habit chart', () => {
  it('judges each day by the goal in force that day', () => {
    const days = habitLifetime(habit(), history, '2024-01-07');
    expect(days.map((d) => d.key)).toEqual([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03',
      '2024-01-04',
      '2024-01-05',
      '2024-01-06',
      '2024-01-07',
    ]);
    expect(days[0]).toMatchObject({ met: true, target: 50 });
    expect(days[3]).toMatchObject({ met: false, target: 100 });
  });

  it('starts at a value recorded before the habit’s origin', () => {
    const days = habitLifetime(habit({ revisions: [] }), history, '2024-01-04');
    expect(days[0].key).toBe('2024-01-01');
  });

  it('groups into calendar weeks and averages per asked day', () => {
    const h = habit();
    const days = habitLifetime(h, history, '2024-01-14');
    // 2024-01-01 is a Monday; Monday-start weeks split the fortnight cleanly in two.
    const weeks = bucketize(h, days, 0, days.length, 'week', 1);
    expect(weeks.map((w) => [w.start, w.end])).toEqual([
      [0, 7],
      [7, 14],
    ]);
    expect(weeks[0]).toMatchObject({ asked: 7, recorded: 2, met: 1, y: 110 / 7, target: 100 });
    // Only the visible part is aggregated: a window inside week two yields just that week.
    expect(bucketize(h, days, 8, 10, 'week', 1)).toHaveLength(1);
  });

  it('measures checkboxes as a share of asked days', () => {
    const h = habit({ type: 'binary', target: undefined, revisions: [] });
    const days = habitLifetime(h, new Map([['2024-01-03', { h: 1 }]]), '2024-01-06');
    expect(bucketize(h, days, 0, days.length, 'month', 1)[0].y).toBe(1 / 4);
  });

  it('marks the days a task was left owing, until it is done', () => {
    const h = habit({ type: 'task', target: undefined, revisions: [], since: '2024-01-01' });
    const days = habitLifetime(h, new Map([['2024-01-04', { h: 1 }]]), '2024-01-06');
    expect(days.map((d) => d.overdueFrom ?? null)).toEqual([
      '2024-01-01',
      '2024-01-01',
      '2024-01-01',
      null,
      null,
      null,
    ]);
    expect(bucketize(h, days, 0, days.length, 'month', 1)[0]).toMatchObject({
      asked: 2,
      met: 1,
      overdue: 3,
    });
  });

  it('finds streaks the way the badge counts them', () => {
    const h = habit({
      type: 'binary',
      target: undefined,
      revisions: [],
      schedule: { kind: 'weekdays', days: [1, 3, 5] },
    });
    // Mon, Wed, Fri done; the next Mon missed; Wed done.
    const done = ['2024-01-01', '2024-01-03', '2024-01-05', '2024-01-10'];
    const days = habitLifetime(h, new Map(done.map((d) => [d, { h: 1 }])), '2024-01-10');
    expect(streakRuns(days)).toEqual([
      { start: 0, end: 5, met: 3 },
      { start: 9, end: 10, met: 1 },
    ]);
  });

  it('counts an unrated asked day as zero', () => {
    const h = habit({ type: 'mood', target: undefined, revisions: [], since: '2024-01-01' });
    const days = habitLifetime(
      h,
      new Map([
        ['2024-01-03', { h: 1 }],
        ['2024-01-04', { h: 5 }],
      ]),
      '2024-01-04',
    );
    expect(bucketize(h, days, 0, 4, 'day', 1).map((b) => b.y)).toEqual([0, 0, 0.2, 1]);
  });

  it('only groups days once bars would get too thin', () => {
    expect(pickGrain(30, 600)).toBe('day');
    expect(pickGrain(365, 600)).toBe('week');
    expect(pickGrain(1800, 600)).toBe('month');
  });
});
