import { describe, expect, it } from 'vitest';
import {
  eventFollowUpScore,
  eventLengthDays,
  eventRememberDays,
  isEventFollowUpDue,
  isEventOngoing,
  isEventUpcoming,
  ongoingEvents,
  pendingEventFollowUps,
  type EventLike,
} from './scoring';

const event = (overrides: Partial<EventLike> = {}): EventLike => ({
  startDate: '2026-07-01',
  endDate: null,
  askedAt: null,
  ...overrides,
});

describe('eventLengthDays', () => {
  it('treats a missing end date as a single day', () => {
    expect(eventLengthDays(event({ startDate: '2026-07-01', endDate: null }))).toBe(1);
  });

  it('counts inclusively', () => {
    expect(eventLengthDays(event({ startDate: '2026-07-01', endDate: '2026-07-01' }))).toBe(1);
    expect(eventLengthDays(event({ startDate: '2026-07-01', endDate: '2026-07-07' }))).toBe(7);
  });

  it('remembers a finished event for 7x its own length', () => {
    expect(eventRememberDays(event({ endDate: null }))).toBe(7);
    expect(eventRememberDays(event({ startDate: '2026-07-01', endDate: '2026-07-14' }))).toBe(98);
  });
});

describe('isEventOngoing / isEventUpcoming', () => {
  const trip = event({ startDate: '2026-07-10', endDate: '2026-07-20' });

  it('spans its whole range, inclusive of both ends', () => {
    expect(isEventOngoing(trip, '2026-07-10')).toBe(true);
    expect(isEventOngoing(trip, '2026-07-15')).toBe(true);
    expect(isEventOngoing(trip, '2026-07-20')).toBe(true);
    expect(isEventOngoing(trip, '2026-07-21')).toBe(false);
    expect(isEventOngoing(trip, '2026-07-09')).toBe(false);
  });

  it('is upcoming only before it starts', () => {
    expect(isEventUpcoming(trip, '2026-07-09')).toBe(true);
    expect(isEventUpcoming(trip, '2026-07-10')).toBe(false);
  });

  it('handles a single-day event with no end date', () => {
    const oneDay = event({ startDate: '2026-07-13', endDate: null });
    expect(isEventOngoing(oneDay, '2026-07-13')).toBe(true);
    expect(isEventOngoing(oneDay, '2026-07-14')).toBe(false);
  });
});

describe('eventFollowUpScore', () => {
  it('is zero while the event is still running', () => {
    const trip = event({ startDate: '2026-07-10', endDate: '2026-07-20' });
    expect(eventFollowUpScore(trip, '2026-07-15')).toBe(0);
  });

  it('is zero on the day it ends — no nagging the same evening', () => {
    const trip = event({ startDate: '2026-07-10', endDate: '2026-07-20' });
    expect(eventFollowUpScore(trip, '2026-07-20')).toBe(0);
    expect(eventFollowUpScore(trip, '2026-07-21')).toBeGreaterThan(0);
  });

  it('is zero once it has been asked about', () => {
    const asked = event({ startDate: '2026-07-01', askedAt: '2026-07-03T10:00:00.000Z' });
    expect(eventFollowUpScore(asked, '2026-07-03')).toBe(0);
    expect(isEventFollowUpDue(asked, '2026-07-03')).toBe(false);
  });

  it('remembers a one-day event for exactly a week, then forgets it', () => {
    const oneDay = event({ startDate: '2026-07-01', endDate: null }); // remember window = 7 days
    expect(isEventFollowUpDue(oneDay, '2026-07-02')).toBe(true); // day 1
    expect(isEventFollowUpDue(oneDay, '2026-07-08')).toBe(true); // day 7 — the last day
    expect(isEventFollowUpDue(oneDay, '2026-07-09')).toBe(false); // day 8 — decayed away
  });

  it('remembers a week-long event far longer (7 x 7 = 49 days)', () => {
    const week = event({ startDate: '2026-07-01', endDate: '2026-07-07' });
    expect(isEventFollowUpDue(week, '2026-08-25')).toBe(true); // day 49
    expect(isEventFollowUpDue(week, '2026-08-26')).toBe(false); // day 50
  });

  it('decays monotonically as the event recedes', () => {
    const trip = event({ startDate: '2026-07-01', endDate: '2026-07-07' });
    const day1 = eventFollowUpScore(trip, '2026-07-08');
    const day10 = eventFollowUpScore(trip, '2026-07-17');
    const day40 = eventFollowUpScore(trip, '2026-08-16');
    expect(day1).toBeGreaterThan(day10);
    expect(day10).toBeGreaterThan(day40);
    expect(day40).toBeGreaterThan(0);
  });

  it('ranks a long event above a short one of the same age', () => {
    // Both ended on 2026-07-07; the fortnight away is the more interesting thing to ask about.
    const fortnight = event({ startDate: '2026-06-24', endDate: '2026-07-07' });
    const oneDay = event({ startDate: '2026-07-07', endDate: null });
    const on = '2026-07-10';
    expect(eventFollowUpScore(fortnight, on)).toBeGreaterThan(eventFollowUpScore(oneDay, on));
  });
});

describe('pendingEventFollowUps', () => {
  it('drops asked, ongoing and long-decayed events, keeping only what is still due', () => {
    const events = [
      { id: 'asked', ...event({ startDate: '2026-07-01', askedAt: '2026-07-05T00:00:00.000Z' }) },
      { id: 'stale', ...event({ startDate: '2026-06-01', endDate: null }) }, // 1-day, long decayed
      { id: 'ongoing', ...event({ startDate: '2026-07-09', endDate: '2026-07-15' }) },
      { id: 'trip', ...event({ startDate: '2026-06-20', endDate: '2026-07-01' }) },
      { id: 'yesterday', ...event({ startDate: '2026-07-09', endDate: null }) },
    ];
    const due = pendingEventFollowUps(events, '2026-07-10');
    expect(new Set(due.map((e) => e.id))).toEqual(new Set(['trip', 'yesterday']));
  });

  it('ranks by how far through its OWN window an event is, not by raw recency', () => {
    // The 12-day trip ended 9 days ago but has an 84-day window — barely started decaying. The
    // one-day thing ended only yesterday, yet is already a seventh of the way through its 7-day
    // window. The trip is the bigger deal, and outranks it. This is the whole point of scaling the
    // decay to the event's length.
    const trip = { id: 'trip', ...event({ startDate: '2026-06-20', endDate: '2026-07-01' }) };
    const yesterday = { id: 'yesterday', ...event({ startDate: '2026-07-09', endDate: null }) };
    const due = pendingEventFollowUps([yesterday, trip], '2026-07-10');
    expect(due.map((e) => e.id)).toEqual(['trip', 'yesterday']);
  });

  it('picks out the ongoing ones separately', () => {
    const events = [
      { id: 'ongoing', ...event({ startDate: '2026-07-09', endDate: '2026-07-15' }) },
      { id: 'past', ...event({ startDate: '2026-07-01', endDate: null }) },
    ];
    expect(ongoingEvents(events, '2026-07-10').map((e) => e.id)).toEqual(['ongoing']);
  });
});
