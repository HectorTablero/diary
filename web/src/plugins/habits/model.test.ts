import { describe, expect, it } from 'vitest';
import { habitAppliesOn, habitCreatedBy, type Habit } from './model';

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
