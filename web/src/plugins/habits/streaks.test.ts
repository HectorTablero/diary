import { describe, expect, it } from 'vitest';
import { currentStreak, dateKeyWindow, streakBefore } from './streaks';

/* Date arithmetic, which is where this feature's bugs would live and where none of them would be
   visible: a streak that is silently one short reads as a user's own misremembering. */

const on = (...keys: string[]) => new Set(keys);

describe('currentStreak', () => {
  it('counts consecutive days back from a ticked day', () => {
    expect(currentStreak(on('2026-08-08', '2026-08-09', '2026-08-10'), '2026-08-10')).toBe(3);
  });

  it('is zero when nothing has been done', () => {
    expect(currentStreak(on(), '2026-08-10')).toBe(0);
  });

  it('stops at the first gap', () => {
    // The 7th is ticked but the 8th is not, so it cannot join the run.
    expect(currentStreak(on('2026-08-07', '2026-08-09', '2026-08-10'), '2026-08-10')).toBe(2);
  });

  it('does not break a streak just because today is still blank', () => {
    /* The reason this rule exists: the day page is read all day. Telling someone at 09:00 that a
       40-day run ended because they haven't done it *yet* is false, and it is the moment they are
       least well served by being told it. */
    expect(currentStreak(on('2026-08-08', '2026-08-09'), '2026-08-10')).toBe(2);
  });

  it('does break it once yesterday is blank too', () => {
    expect(currentStreak(on('2026-08-07', '2026-08-08'), '2026-08-10')).toBe(0);
  });

  it('counts a single day', () => {
    expect(currentStreak(on('2026-08-10'), '2026-08-10')).toBe(1);
  });

  it('crosses a month boundary', () => {
    expect(currentStreak(on('2026-07-31', '2026-08-01'), '2026-08-01')).toBe(2);
  });

  it('crosses a leap day', () => {
    expect(currentStreak(on('2028-02-28', '2028-02-29', '2028-03-01'), '2028-03-01')).toBe(3);
  });

  it('crosses a year boundary', () => {
    expect(currentStreak(on('2026-12-31', '2027-01-01'), '2027-01-01')).toBe(2);
  });

  it('crosses spring-forward without losing or repeating a day', () => {
    /* The case a `-86_400_000` walk gets wrong. On the day the clocks go forward the previous
       midnight is 23 hours back, not 24, so a millisecond step lands on the same calendar day and
       counts it twice — or, stepping from the other side, skips one and ends the streak early.
       These are European DST dates; the assertion holds in any zone because the walk is by
       calendar day, which is what the keys mean. */
    const march = on('2026-03-28', '2026-03-29', '2026-03-30');
    expect(currentStreak(march, '2026-03-30')).toBe(3);
  });

  it('crosses autumn fall-back without losing or repeating a day', () => {
    const october = on('2026-10-24', '2026-10-25', '2026-10-26');
    expect(currentStreak(october, '2026-10-26')).toBe(3);
  });

  it('ignores days after the one asked about', () => {
    /* Browsing back to a past day shows the streak *as it stood then*, not the length of the run
       that day turned out to be part of. On the 9th the answer was 1, and that is what the diary
       should say when you are looking at the 9th — the 10th and 11th hadn't happened yet. */
    expect(currentStreak(on('2026-08-09', '2026-08-10', '2026-08-11'), '2026-08-09')).toBe(1);
  });
});

describe('streakBefore', () => {
  /* The day page's number. It is worth its own tests rather than being trusted to fall out of
     `currentStreak`, because the property the card relies on is specifically that *today cannot
     change it* — that is the whole reason the badge stops flickering. */

  it('is the run ending yesterday', () => {
    expect(streakBefore(on('2026-08-08', '2026-08-09'), '2026-08-10')).toBe(2);
  });

  it('does not count the day asked about, however it went', () => {
    const before = on('2026-08-08', '2026-08-09');
    const after = on('2026-08-08', '2026-08-09', '2026-08-10');
    // Ticking today is what the card adds itself; the base it adds to must not move.
    expect(streakBefore(after, '2026-08-10')).toBe(streakBefore(before, '2026-08-10'));
  });

  it('is zero when yesterday was missed, whatever came before it', () => {
    expect(streakBefore(on('2026-08-01', '2026-08-02', '2026-08-08'), '2026-08-10')).toBe(0);
  });

  it('plus today is exactly the current streak', () => {
    // The identity the day widget is built on, asserted in both directions.
    const met = on('2026-08-08', '2026-08-09', '2026-08-10');
    expect(streakBefore(met, '2026-08-10') + 1).toBe(currentStreak(met, '2026-08-10'));

    const blankToday = on('2026-08-08', '2026-08-09');
    expect(streakBefore(blankToday, '2026-08-10')).toBe(currentStreak(blankToday, '2026-08-10'));
  });
});

describe('dateKeyWindow', () => {
  it('returns the window oldest-first, ending on the given day', () => {
    expect(dateKeyWindow('2026-08-10', 3)).toEqual(['2026-08-08', '2026-08-09', '2026-08-10']);
  });

  it('handles a window of one', () => {
    expect(dateKeyWindow('2026-08-10', 1)).toEqual(['2026-08-10']);
  });

  it('crosses a month boundary', () => {
    expect(dateKeyWindow('2026-03-02', 4)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });
});
