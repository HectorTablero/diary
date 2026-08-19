import { describe, expect, it } from 'vitest';
import { applyPatch, decodePatch, diffText, encodePatch } from './patch';

/* The diff itself is tested in lib/textDiff.test.ts, which is where it now lives. What is left here
   is this plugin's half: writing a patch down, reading it back, and — the part that has to keep
   working forever — reading back one written by an older build in the old line format. */

const roundTrips = (before: string, after: string) =>
  applyPatch(before, decodePatch(encodePatch(diffText(before, after)))) === after;

describe('encodePatch / decodePatch / applyPatch', () => {
  it('round-trips an edit through storage', () => {
    expect(roundTrips('One. Two. Three.', 'One. Two changed. Three.')).toBe(true);
  });

  it('round-trips writing from nothing, and emptying', () => {
    expect(roundTrips('', 'First thought.')).toBe(true);
    expect(roundTrips('First thought.', '')).toBe(true);
  });

  it('round-trips a document written in Japanese', () => {
    expect(roundTrips('こんにちは。元気ですか？', 'こんにちは。元気ですか？また明日。')).toBe(true);
  });

  it('preserves blank lines, which is what separates paragraphs in prose', () => {
    const before = 'Para one.\n\nPara two.';
    expect(roundTrips(before, `${before}\n\nPara three.`)).toBe(true);
    expect(
      applyPatch(before, decodePatch(encodePatch(diffText(before, `${before}\n\nPara three.`)))),
    ).toBe('Para one.\n\nPara two.\n\nPara three.');
  });

  it('stays small for an append to a long document', () => {
    const long = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}.`).join('\n');
    expect(encodePatch(diffText(long, `${long}\nAnd one more.`)).length).toBeLessThan(120);
  });
});

/* The format version, and the whole reason it exists. A chain can be half line-format and half
   sentence-format — every document written before this change is — and both halves must replay
   exactly as their own build meant them to. Getting this wrong loses every line break in someone's
   history, silently, months after the fact. */
describe('the line format written by older builds', () => {
  /* A bare array with no version stamp: exactly what encodePatch used to produce. */
  const legacy = JSON.stringify([
    ['=', 1],
    ['+', ['second line']],
  ]);

  it('is recognised by its shape and joined back with newlines', () => {
    expect(decodePatch(legacy).units).toBe('line');
    expect(applyPatch('first line', decodePatch(legacy))).toBe('first line\nsecond line');
  });

  it('is not confused with what this build writes', () => {
    expect(decodePatch(encodePatch(diffText('a', 'b'))).units).toBe('sentence');
  });

  /* The mistake this guards against, stated as an assertion: applying a line patch with the
     sentence rule concatenates the lines instead of separating them. */
  it('would lose every line break if replayed with the sentence rule', () => {
    expect(applyPatch('first line', { units: 'sentence', ops: decodePatch(legacy).ops })).toBe(
      'first linesecond line',
    );
  });
});

describe('decodePatch', () => {
  /* Same posture as every other plugin read: the server never looked at this string. A history
     screen must not be able to throw because one row is malformed. */
  it.each(['not json', '{}', '{"v":99,"ops":[]}', '[["?",1]]', '[["=",-1]]', '[["+",[1,2]]]'])(
    'treats %s as no change rather than throwing',
    (body) => {
      expect(decodePatch(body).ops).toEqual([]);
    },
  );

  it('drops only the invalid ops, keeping the rest of a partly-readable patch', () => {
    expect(decodePatch('{"v":2,"ops":[["=",2],["?",9],["+",["x"]]]}').ops).toEqual([
      ['=', 2],
      ['+', ['x']],
    ]);
  });
});

describe('applyPatch tolerance', () => {
  /* A chain can legitimately stop lining up — a rename rewrote the document's text, or a merge
     rewrote a day. Reading old history must degrade, never crash. */
  it('stops at the end of the source instead of throwing', () => {
    expect(applyPatch('one sentence.', { units: 'sentence', ops: [['=', 50]] })).toBe(
      'one sentence.',
    );
    expect(applyPatch('', { units: 'sentence', ops: [['-', 3]] })).toBe('');
  });
});
