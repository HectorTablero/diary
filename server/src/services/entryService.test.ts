import { describe, expect, it } from 'vitest';
import { isDuplicateKey } from '../errors';
import { saidToIdList, saidToProvidedAt } from './entryService';

/*
 * entryService's own decisions, separated from the database.
 *
 * The tree arithmetic this file used to carry — depth, subtree height, cycle detection, the
 * descendant set behind the dateKey cascade and the delete — now comes from shared/tree.ts and is
 * covered there, against the very same functions the client validates a drag with. What is left
 * here is the part that is genuinely the server's: how a client's `saidTo` is normalised, and how a
 * duplicate-key error is told apart from a real conflict.
 */

describe('saidTo normalisation', () => {
  /* Two shapes reach this. A bare person id is the ordinary case — someone was mentioned, and the
     server stamps the time itself. A {personId, at} pair is a client restoring history, which is
     what a backup import does: those timestamps are the real dates things were said, months ago,
     and treating them as "now" would silently rewrite the record being restored. */

  it('reads ids out of both shapes', () => {
    expect(saidToIdList(['a', { personId: 'b', at: '2026-01-02T00:00:00.000Z' }])).toEqual([
      'a',
      'b',
    ]);
  });

  it('treats an absent saidTo as empty rather than throwing', () => {
    // undefined is meaningful further up — it means "auto-said from the mentions" — but by the
    // time it reaches here it must simply contribute nothing.
    expect(saidToIdList(undefined)).toEqual([]);
    expect(saidToProvidedAt(undefined).size).toBe(0);
  });

  it('collects a timestamp only from the explicit shape', () => {
    const at = '2026-01-02T03:04:05.000Z';
    const provided = saidToProvidedAt(['a', { personId: 'b', at }]);

    // 'a' contributes nothing, so the caller's `?? now` fallback still applies to it — which is
    // what keeps older clients behaving exactly as they did before the pair shape existed.
    expect(provided.has('a')).toBe(false);
    expect(provided.get('b')).toEqual(new Date(at));
  });

  it('keeps the last timestamp when a person appears twice', () => {
    const provided = saidToProvidedAt([
      { personId: 'b', at: '2026-01-01T00:00:00.000Z' },
      { personId: 'b', at: '2026-06-01T00:00:00.000Z' },
    ]);
    expect(provided.get('b')).toEqual(new Date('2026-06-01T00:00:00.000Z'));
  });
});

describe('isDuplicateKey', () => {
  /* This is what stands between a replayed create and data loss. The outbox only drops an op once
     its response arrives, so a create whose response was lost gets sent again — and the client
     reads a 409 on POST as "my local copy is a phantom" and deletes the row. When the collision is
     on _id, the document is already there and the create has in fact succeeded; when it is on a
     name, it is a real conflict the user has to resolve. Telling those apart is this function. */

  const dupe = (keyPattern?: Record<string, number>) => ({ code: 11000, keyPattern });

  it('recognises a duplicate-key error', () => {
    expect(isDuplicateKey(dupe({ _id: 1 }))).toBe(true);
  });

  it('narrows to the index that actually collided', () => {
    expect(isDuplicateKey(dupe({ _id: 1 }), '_id')).toBe(true);
    // A duplicate *name* must never be mistaken for a replay: answering it as success would hand
    // back somebody else's tag as though the create had worked.
    expect(isDuplicateKey(dupe({ name: 1 }), '_id')).toBe(false);
  });

  it('answers false for the narrowed form when the driver omits keyPattern', () => {
    // Conservative on purpose: without knowing which index raised it, the safe reading is "real
    // conflict", which surfaces to the user rather than silently returning the wrong document.
    expect(isDuplicateKey(dupe(undefined), '_id')).toBe(false);
    expect(isDuplicateKey(dupe(undefined))).toBe(true);
  });

  it('ignores anything that is not a duplicate-key error', () => {
    expect(isDuplicateKey({ code: 121 })).toBe(false);
    expect(isDuplicateKey(new Error('network'))).toBe(false);
    expect(isDuplicateKey(null)).toBe(false);
    expect(isDuplicateKey(undefined)).toBe(false);
    expect(isDuplicateKey('11000')).toBe(false);
  });
});
