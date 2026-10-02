import { TOMBSTONE_RETENTION_MS } from '@diary/shared';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Deletion, findTombstone, isCursorStale } from './deletion';

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

/*
 * The tombstone lookup a create makes alongside its other work. It has to be exactly as effective as
 * the unconditional delete it replaced for the one case that delete was for — undo re-creating a
 * deleted id — while leaving every other create without a write it never needed.
 */
describe('findTombstone', () => {
  const ID = '0000000000000000000000a1';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retracts a tombstone that is there, and only when told to', async () => {
    vi.spyOn(Deletion, 'exists').mockResolvedValue({ _id: new Types.ObjectId() } as never);
    const deleteMany = vi.spyOn(Deletion, 'deleteMany').mockResolvedValue({} as never);

    const retract = await findTombstone('u1', 'entry', ID);
    // Looking is not retracting: the create has not landed yet.
    expect(deleteMany).not.toHaveBeenCalled();

    await retract();
    expect(deleteMany).toHaveBeenCalledWith({
      userId: 'u1',
      coll: 'entry',
      docId: { $in: [new Types.ObjectId(ID)] },
    });
  });

  it('writes nothing when there is no tombstone, which is almost always', async () => {
    const exists = vi.spyOn(Deletion, 'exists').mockResolvedValue(null as never);
    const deleteMany = vi.spyOn(Deletion, 'deleteMany').mockResolvedValue({} as never);

    await (
      await findTombstone('u1', 'person', ID)
    )();

    expect(exists).toHaveBeenCalledWith({
      userId: 'u1',
      coll: 'person',
      docId: new Types.ObjectId(ID),
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('does not even look for a server-minted id, which has never been deleted', async () => {
    const exists = vi.spyOn(Deletion, 'exists');

    await (
      await findTombstone('u1', 'tag', undefined)
    )();

    expect(exists).not.toHaveBeenCalled();
  });
});
