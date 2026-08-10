import { describe, expect, it } from 'vitest';
import { habitChanges } from './changes';
import { configAt, metTarget, type Habit } from './model';

/* The bug this whole mechanism exists to prevent, stated as a test: raising a goal must not
   retroactively un-meet the days you met the old one. It is invisible when it happens — the grid
   simply redraws — and unrecoverable by the user, who has no way to say "no, fifty was the goal
   then". */

const habit = (patch: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Push-ups',
  type: 'numeric',
  target: 100,
  since: '2026-03-01',
  revisions: [
    { since: '2026-01-01', changedAt: '2026-03-01T09:00:00.000Z', name: 'Push-ups', target: 50 },
  ],
  order: 0,
  archivedAt: null,
  ...patch,
});

describe('the goal in force on a day', () => {
  it('is the old one before the change', () => {
    expect(configAt(habit(), '2026-02-14').target).toBe(50);
  });

  it('is the new one from the day of the change', () => {
    expect(configAt(habit(), '2026-03-01').target).toBe(100);
    expect(configAt(habit(), '2026-06-01').target).toBe(100);
  });

  it('falls back to the earliest recorded config for a day older than any of them', () => {
    expect(configAt(habit(), '2025-06-01').target).toBe(50);
  });

  it('is simply the current config when no date is asked about', () => {
    expect(configAt(habit()).target).toBe(100);
  });

  it('is the current config for a habit that has never been edited', () => {
    expect(configAt(habit({ revisions: [], since: '' }), '2020-01-01').target).toBe(100);
  });
});

describe('whether a day met its goal', () => {
  it('judges an old day by the goal that was in force then', () => {
    // 50 push-ups in February, when the goal was 50. Met — and still met after the goal doubled.
    expect(metTarget(habit(), 50, '2026-02-14')).toBe(true);
  });

  it('judges a new day by the new goal', () => {
    expect(metTarget(habit(), 50, '2026-03-02')).toBe(false);
    expect(metTarget(habit(), 100, '2026-03-02')).toBe(true);
  });

  it('still counts nothing as nothing', () => {
    expect(metTarget(habit(), 0, '2026-02-14')).toBe(false);
  });

  it('treats a rating as met by being recorded at all', () => {
    // There is no falling short of "how did you sleep".
    expect(metTarget(habit({ type: 'scale', target: undefined }), 1, '2026-02-14')).toBe(true);
  });
});

describe('the change log', () => {
  const t = ((key: string, vars?: Record<string, unknown>) =>
    `${key}:${JSON.stringify(vars ?? {})}`) as unknown as Parameters<typeof habitChanges>[1];

  it('reports one transition per edit, dated from when it applied', () => {
    const changes = habitChanges(habit(), t);

    expect(changes).toHaveLength(1);
    expect(changes[0].since).toBe('2026-03-01');
    expect(changes[0].lines[0]).toContain('changeGoal');
    expect(changes[0].lines[0]).toContain('50');
    expect(changes[0].lines[0]).toContain('100');
  });

  it('says nothing about a habit that was never edited', () => {
    expect(habitChanges(habit({ revisions: [] }), t)).toEqual([]);
  });

  it('reports a rename separately from a goal change', () => {
    const renamed = habit({
      name: 'Press-ups',
      revisions: [
        {
          since: '2026-01-01',
          changedAt: '2026-03-01T09:00:00.000Z',
          name: 'Push-ups',
          target: 100,
        },
      ],
    });

    const [change] = habitChanges(renamed, t);

    expect(change.lines).toHaveLength(1);
    expect(change.lines[0]).toContain('changeName');
  });
});
