import { describe, expect, it } from 'vitest';
import { applyPatch, decodePatch, diffLines, encodePatch } from './patch';

/* The one property that has to hold for every input, since the whole history feature rests on it:
   applying a document's patch reproduces the text it was made from. Everything else here is about
   the patch staying *small*, which is the reason the format exists at all. */
const roundTrips = (before: string, after: string) =>
  applyPatch(before, diffLines(before, after)) === after;

describe('diffLines / applyPatch', () => {
  it('round-trips an edit in the middle of a document', () => {
    const before = 'one\ntwo\nthree\nfour';
    expect(roundTrips(before, 'one\ntwo CHANGED\nthree\nfour')).toBe(true);
  });

  it('round-trips writing from nothing, and emptying', () => {
    expect(roundTrips('', 'first thought')).toBe(true);
    expect(roundTrips('first thought', '')).toBe(true);
  });

  it('round-trips inserts, deletes and pure reordering', () => {
    expect(roundTrips('a\nb\nc', 'a\nb\nb2\nc')).toBe(true);
    expect(roundTrips('a\nb\nc', 'a\nc')).toBe(true);
    expect(roundTrips('a\nb\nc', 'c\nb\na')).toBe(true);
  });

  it('preserves blank lines, which is what separates paragraphs in prose', () => {
    const before = 'para one\n\npara two';
    expect(roundTrips(before, 'para one\n\npara two\n\npara three')).toBe(true);
    expect(
      applyPatch(before, diffLines(before, `${before}\n\npara three`)).split('\n'),
    ).toHaveLength(5);
  });

  it('emits nothing for an unchanged document', () => {
    expect(diffLines('same\ntext', 'same\ntext')).toEqual([['=', 2]]);
  });

  /* The reason the prefix/suffix trim exists. Appending one paragraph to a long document must cost
     one insert, not a rewrite — otherwise a year of daily edits stores the document a year over. */
  it('keeps a one-paragraph append to a long document to a single insert', () => {
    const long = Array.from({ length: 900 }, (_, i) => `paragraph ${i}`).join('\n');
    const ops = diffLines(long, `${long}\nand one more`);
    expect(ops).toEqual([
      ['=', 900],
      ['+', ['and one more']],
    ]);
    expect(encodePatch(ops).length).toBeLessThan(60);
  });

  /* Past MAX_LCS_LINES the middle is replaced wholesale rather than diffed. Correctness is the
     promise; compactness is not, and this pins the fallback so a change to the cap can't silently
     turn it into a hang. */
  it('still round-trips when the changed region is too large to diff', () => {
    const before = Array.from({ length: 500 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 500 }, (_, i) => `b${i}`).join('\n');
    expect(roundTrips(before, after)).toBe(true);
  });

  it('coalesces runs rather than emitting one op per line', () => {
    const before = 'k\nx1\nx2\nx3\nk2';
    const after = 'k\nk2';
    expect(diffLines(before, after)).toEqual([
      ['=', 1],
      ['-', 3],
      ['=', 1],
    ]);
  });
});

describe('decodePatch', () => {
  it('round-trips through JSON', () => {
    const ops = diffLines('a\nb', 'a\nc');
    expect(decodePatch(encodePatch(ops))).toEqual(ops);
  });

  /* Same posture as every other plugin read: the server never looked at this string. A history
     screen must not be able to throw because one row is malformed. */
  it.each(['not json', '{}', '[["?",1]]', '[["=", -1]]', '[["+", [1,2]]]', '[[1,2,3]]'])(
    'treats %s as no change rather than throwing',
    (body) => {
      expect(decodePatch(body)).toEqual([]);
    },
  );

  it('drops only the invalid ops, keeping the rest of a partly-readable patch', () => {
    expect(decodePatch('[["=",2],["?",9],["+",["x"]]]')).toEqual([
      ['=', 2],
      ['+', ['x']],
    ]);
  });
});

describe('applyPatch tolerance', () => {
  /* A chain can legitimately stop lining up — a rename rewrote the document's text, or two devices'
     same-day writes converged. Reading old history must degrade, never crash. */
  it('stops at the end of the source instead of throwing', () => {
    expect(applyPatch('one line', [['=', 50]])).toBe('one line');
    expect(applyPatch('', [['-', 3]])).toBe('');
  });
});
