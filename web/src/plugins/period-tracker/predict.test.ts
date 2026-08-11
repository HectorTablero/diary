import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CYCLE_LENGTH_DAYS,
  DEFAULT_PERIOD_LENGTH_DAYS,
  dateKeysBetween,
  groupCycles,
  outlookFor,
  predictNext,
  type Cycle,
} from './predict';

/* Date arithmetic, same posture as habits/streaks.test.ts: this is where the bugs would live and
   where none of them would be visible — a prediction that is quietly a day off just reads as the
   app being a little wrong, forever, in a way nobody would think to report. */

describe('groupCycles', () => {
  it('groups consecutive days into one cycle', () => {
    expect(groupCycles(['2026-08-01', '2026-08-02', '2026-08-03'])).toEqual([
      { start: '2026-08-01', end: '2026-08-03' },
    ]);
  });

  it('splits on a gap', () => {
    expect(groupCycles(['2026-08-01', '2026-08-02', '2026-08-10'])).toEqual([
      { start: '2026-08-01', end: '2026-08-02' },
      { start: '2026-08-10', end: '2026-08-10' },
    ]);
  });

  it('does not care about input order or duplicates', () => {
    expect(groupCycles(['2026-08-03', '2026-08-01', '2026-08-02', '2026-08-02'])).toEqual([
      { start: '2026-08-01', end: '2026-08-03' },
    ]);
  });

  it('is empty for no days', () => {
    expect(groupCycles([])).toEqual([]);
  });

  it('crosses a month boundary as one cycle', () => {
    expect(groupCycles(['2026-07-31', '2026-08-01'])).toEqual([
      { start: '2026-07-31', end: '2026-08-01' },
    ]);
  });
});

describe('predictNext', () => {
  it('predicts nothing from zero cycles', () => {
    expect(predictNext([])).toBeUndefined();
  });

  it('falls back to population averages from a single cycle', () => {
    const cycles: Cycle[] = [{ start: '2026-07-01', end: '2026-07-05' }];
    const prediction = predictNext(cycles);
    const expectedStart = addDaysKey('2026-07-01', DEFAULT_CYCLE_LENGTH_DAYS);
    expect(prediction).toEqual({
      start: expectedStart,
      end: addDaysKey(expectedStart, DEFAULT_PERIOD_LENGTH_DAYS - 1),
    });
  });

  it('averages real gaps and durations once there are two or more cycles', () => {
    const cycles: Cycle[] = [
      { start: '2026-06-01', end: '2026-06-04' }, // 4-day period
      { start: '2026-06-29', end: '2026-07-03' }, // gap 28, 5-day period
    ];
    const prediction = predictNext(cycles);
    // gap: 28 days; duration: mean(4, 5) = 4.5 -> rounds to 5 (banker's/standard rounding of .5 up)
    expect(prediction).toEqual({
      start: '2026-07-27',
      end: '2026-07-31',
    });
  });

  it('only looks at the most recent cycles when there are many', () => {
    // An ancient, very long gap must not still be dragging the average down.
    const cycles: Cycle[] = [
      { start: '2020-01-01', end: '2020-01-05' },
      { start: '2026-01-01', end: '2026-01-05' },
      { start: '2026-01-29', end: '2026-02-02' }, // gap 28
      { start: '2026-02-26', end: '2026-03-02' }, // gap 28
      { start: '2026-03-26', end: '2026-03-30' }, // gap 28
      { start: '2026-04-23', end: '2026-04-27' }, // gap 28
      { start: '2026-05-21', end: '2026-05-25' }, // gap 28
    ];
    const prediction = predictNext(cycles);
    expect(prediction?.start).toBe(addDaysKey('2026-05-21', 28));
  });
});

describe('outlookFor', () => {
  const prediction = { start: '2026-08-10', end: '2026-08-14' };

  it('is none with no prediction at all', () => {
    expect(outlookFor('2026-08-10', undefined)).toEqual({ kind: 'none' });
  });

  it('is none far before the predicted window', () => {
    expect(outlookFor('2026-08-01', prediction)).toEqual({ kind: 'none' });
  });

  it('approaches within the warning window before the start', () => {
    expect(outlookFor('2026-08-06', prediction)).toEqual({ kind: 'approaching', daysUntil: 4 });
    expect(outlookFor('2026-08-09', prediction)).toEqual({ kind: 'approaching', daysUntil: 1 });
  });

  it('is due on the first predicted day', () => {
    expect(outlookFor('2026-08-10', prediction)).toEqual({ kind: 'due' });
  });

  it('stays due through the predicted window', () => {
    expect(outlookFor('2026-08-14', prediction)).toEqual({ kind: 'due' });
  });

  it('stays due through the overdue grace period', () => {
    expect(outlookFor('2026-08-21', prediction)).toEqual({ kind: 'due' });
  });

  it('goes quiet once the grace period has passed', () => {
    expect(outlookFor('2026-08-22', prediction)).toEqual({ kind: 'none' });
  });
});

describe('dateKeysBetween', () => {
  it('is inclusive on both ends', () => {
    expect(dateKeysBetween('2026-08-01', '2026-08-03')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('is a single key when start equals end', () => {
    expect(dateKeysBetween('2026-08-01', '2026-08-01')).toEqual(['2026-08-01']);
  });
});

/** Test-only helper: a dateKey N days after another, via the same local-date stepping predict.ts
    uses, so an assertion never encodes the bug it means to catch. */
function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
