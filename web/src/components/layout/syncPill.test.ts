import { describe, expect, it } from 'vitest';
import { shouldShowBlocker } from './syncPill';

/*
 * When the sync pill is on screen.
 *
 * The rule it encodes is that `paused` is not a failure — nothing is broken, the app is holding
 * writes back because it was told to — while `offline` and `unreachable` are. So only `paused` can
 * ever be hidden, and hiding either of the others would turn "your diary has stopped backing
 * itself up" into silence, which is the failure mode this pill exists to prevent.
 *
 * Extracted from the component so the rule can be stated once and checked without a DOM. It says
 * nothing about the sync engine's own `blocker`, which still reads `paused` throughout — that is
 * what disables the voice recorder on a metered connection.
 */
describe('shouldShowBlocker', () => {
  it('says nothing when nothing is blocking sync', () => {
    expect(shouldShowBlocker(null, 0, false)).toBe(false);
    expect(shouldShowBlocker(null, 5, false)).toBe(false);
  });

  it('shows the wi-fi hold only once something is actually being held', () => {
    // With an empty outbox the pill would be announcing a setting rather than a state.
    expect(shouldShowBlocker('paused', 0, false)).toBe(false);
    expect(shouldShowBlocker('paused', 1, false)).toBe(true);
  });

  it('lets the preference hide the wi-fi hold even with writes queued', () => {
    expect(shouldShowBlocker('paused', 3, true)).toBe(false);
  });

  it('never lets the preference hide a real failure', () => {
    /* The important case. Someone who turned the pill off to stop being nagged about Wi-Fi has
       not asked to stop being told their writes are not reaching the server at all. */
    for (const pending of [0, 4]) {
      expect(shouldShowBlocker('offline', pending, true)).toBe(true);
      expect(shouldShowBlocker('unreachable', pending, true)).toBe(true);
    }
  });

  it('shows offline and unreachable with nothing queued too', () => {
    // Still worth saying: it is also why nothing is arriving from other devices.
    expect(shouldShowBlocker('offline', 0, false)).toBe(true);
    expect(shouldShowBlocker('unreachable', 0, false)).toBe(true);
  });
});
