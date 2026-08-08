import { TOMBSTONE_RETENTION_MS } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import { isCursorStale } from './deletion';

/*
 * The one decision in this file that isn't a database call: whether a client's cursor still lands
 * inside the window where tombstones exist.
 *
 * Getting it wrong in either direction is invisible from the outside. Too strict and every device
 * downloads the whole diary on a routine sync; too lax and a pull looks perfectly healthy while
 * quietly failing to mention a delete, leaving that doc on that device for good.
 */

const NOW = new Date('2026-08-08T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('isCursorStale', () => {
  it('serves a cursor from within the window', () => {
    expect(isCursorStale(ago(0), NOW)).toBe(false);
    expect(isCursorStale(ago(TOMBSTONE_RETENTION_MS / 2), NOW)).toBe(false);
  });

  it('resets a cursor from beyond it', () => {
    expect(isCursorStale(ago(TOMBSTONE_RETENTION_MS + 1), NOW)).toBe(true);
    expect(isCursorStale(ago(TOMBSTONE_RETENTION_MS * 2), NOW)).toBe(true);
  });

  it('serves the exact boundary', () => {
    /* A cursor of exactly `now - window` is still fresh, matching the `$gt` the pull query uses:
       a tombstone written at that instant is not returned to it either way, so the two agree. The
       week of TTL grace is what makes this edge safe rather than a race. */
    expect(isCursorStale(ago(TOMBSTONE_RETENTION_MS), NOW)).toBe(false);
  });

  it('serves a cursor from the future rather than resetting on a wrong clock', () => {
    // A device whose clock runs fast writes a cursor ahead of the server's now. It will miss
    // changes until the clock catches up, but that heals; a reset every sync would not.
    expect(isCursorStale(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(false);
  });
});
