import { describe, expect, it } from 'vitest';
import { ageOn, birthdayFallsOn, birthdaysOn, formatBirthdayValue, parseBirthday } from './birthday';

describe('parseBirthday', () => {
  it('reads a full date', () => {
    expect(parseBirthday('1990-07-13')).toEqual({ year: 1990, month: 7, day: 13 });
  });

  it('reads a year-less birthday', () => {
    expect(parseBirthday('--07-13')).toEqual({ year: null, month: 7, day: 13 });
  });

  it('rejects anything malformed', () => {
    expect(parseBirthday('13/07/1990')).toBeNull();
    expect(parseBirthday('1990-13-01')).toBeNull();
    expect(parseBirthday(null)).toBeNull();
  });

  // LEGACY (droppable at the next Dexie upversion — see db.ts)
  it('still reads the legacy triple-dash year-less form written by an early build', () => {
    expect(parseBirthday('---10-10')).toEqual({ year: null, month: 10, day: 10 });
    expect(parseBirthday('---07-13')).toEqual({ year: null, month: 7, day: 13 });
  });

  it('treats legacy rows as real birthdays everywhere downstream', () => {
    expect(birthdayFallsOn('---10-10', '2026-10-10')).toBe(true);
    expect(birthdayFallsOn('---10-10', '2026-10-11')).toBe(false);
    expect(ageOn('---10-10', new Date(2026, 9, 10))).toBeNull();
  });

  it('round-trips through formatBirthdayValue', () => {
    expect(formatBirthdayValue(null, 7, 13)).toBe('--07-13');
    expect(formatBirthdayValue(1990, 7, 13)).toBe('1990-07-13');
  });
});

describe('ageOn', () => {
  it('is null when the year is unknown', () => {
    expect(ageOn('--07-13', new Date(2026, 6, 13))).toBeNull();
  });

  it('does not count the birthday until it has passed', () => {
    expect(ageOn('1990-07-13', new Date(2026, 6, 12))).toBe(35);
    expect(ageOn('1990-07-13', new Date(2026, 6, 13))).toBe(36);
  });
});

describe('birthdayFallsOn', () => {
  it('ignores the stored year — it is the anniversary that matters', () => {
    expect(birthdayFallsOn('1990-07-13', '2026-07-13')).toBe(true);
    expect(birthdayFallsOn('--07-13', '2026-07-13')).toBe(true);
    expect(birthdayFallsOn('1990-07-13', '2026-07-14')).toBe(false);
  });

  it('observes a 29 February birthday on the 28th in non-leap years', () => {
    // 2027 is not a leap year: without this the birthday would vanish for three years running.
    expect(birthdayFallsOn('2000-02-29', '2027-02-28')).toBe(true);
    expect(birthdayFallsOn('2000-02-29', '2028-02-29')).toBe(true);
    expect(birthdayFallsOn('2000-02-29', '2028-02-28')).toBe(false);
  });

  it('ignores people with no birthday', () => {
    expect(birthdayFallsOn(null, '2026-07-13')).toBe(false);
  });
});

describe('birthdaysOn', () => {
  it('picks out only the people celebrating that day', () => {
    const people = [
      { id: 'a', birthday: '--07-13' },
      { id: 'b', birthday: '1988-07-13' },
      { id: 'c', birthday: '1990-01-01' },
      { id: 'd', birthday: null },
    ];
    expect(birthdaysOn(people, '2026-07-13').map((p) => p.id)).toEqual(['a', 'b']);
  });
});
