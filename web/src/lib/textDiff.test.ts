import { describe, expect, it } from 'vitest';
import { applyUnitOps, diffSentences, diffUnits, graphemes, sentences } from './textDiff';

describe('sentences', () => {
  /* The invariant the storage format and the merge both rest on. Everything else in this file is
     about the split being *useful*; this is about it being lossless. */
  const tiles = (text: string) => sentences(text).join('') === text;

  it.each([
    'One. Two. Three.',
    'Compare e.g. this. Then that.',
    'para one\n\npara two',
    'trailing newline\n',
    '   ',
    '- milk\n- bread\n',
    'こんにちは。元気ですか？',
    '# Heading\n\nBody text. More body.',
    'No terminator at all',
    'Ellipsis… then more. And an emoji 👍🏽 too.',
  ])('tiles %j exactly, so joining the segments returns the text', (text) => {
    expect(tiles(text)).toBe(true);
  });

  it('is no segments for an empty text, not one empty segment', () => {
    expect(sentences('')).toEqual([]);
  });

  it('splits English on the full stop, keeping the space with the sentence it follows', () => {
    expect(sentences('One. Two.')).toEqual(['One. ', 'Two.']);
  });

  /* The reason this uses Intl.Segmenter at all. A full-stop-based split sees one sentence here,
     which would make every edit to a Japanese note collide with every other. */
  it('splits Japanese on 。 and ？ rather than on the full stop', () => {
    expect(sentences('こんにちは。元気ですか？また明日。')).toEqual([
      'こんにちは。',
      '元気ですか？',
      'また明日。',
    ]);
  });

  it('splits Chinese on its fullwidth terminators', () => {
    expect(sentences('今天很好。明天见！')).toEqual(['今天很好。', '明天见！']);
  });

  /* Two artefacts of the Unicode algorithm, pinned here because they look like bugs and are not.
     A lowercase word after a full stop does not start a new sentence — the rule that keeps `e.g.
     this` in one piece — and a bracket immediately after a terminator belongs to the sentence that
     ended, because UAX #29 treats opening and closing punctuation alike. Both only move a unit
     boundary; nothing in the diff or the merge depends on a boundary being where a grammarian
     would have put it. */
  it('does not break before a lowercase word, which is what keeps "e.g. this" whole', () => {
    expect(sentences('Compare e.g. this to that.')).toEqual(['Compare e.g. this to that.']);
  });

  it('keeps a bracket that follows a terminator with the sentence it followed', () => {
    expect(sentences('元気ですか？「はい」と言った。')).toEqual([
      '元気ですか？「',
      'はい」と言った。',
    ]);
  });

  /* A newline ends a segment whatever came before it, which is what keeps headings, list items and
     blank lines as units of their own rather than swallowed into a neighbouring sentence. */
  it('ends a segment at a newline even with no terminator', () => {
    expect(sentences('- milk\n- bread')).toEqual(['- milk\n', '- bread']);
    expect(sentences('a\n\nb')).toEqual(['a\n', '\n', 'b']);
  });
});

describe('graphemes', () => {
  it('keeps an emoji with its modifier together', () => {
    expect(graphemes('a👍🏽b')).toEqual(['a', '👍🏽', 'b']);
  });

  it('tiles the text exactly, like sentences does', () => {
    expect(graphemes('héllo 👍🏽').join('')).toBe('héllo 👍🏽');
  });
});

describe('diffUnits / applyUnitOps', () => {
  const roundTrips = (before: string, after: string) =>
    applyUnitOps(sentences(before), diffSentences(before, after)).join('') === after;

  it('round-trips an edit in the middle of a document', () => {
    const before = 'One. Two. Three. Four.';
    expect(roundTrips(before, 'One. Two changed. Three. Four.')).toBe(true);
  });

  it('round-trips writing from nothing, and emptying', () => {
    expect(roundTrips('', 'First thought.')).toBe(true);
    expect(roundTrips('First thought.', '')).toBe(true);
  });

  it('round-trips inserts, deletes and pure reordering', () => {
    expect(roundTrips('A. B. C.', 'A. B. B2. C.')).toBe(true);
    expect(roundTrips('A. B. C.', 'A. C.')).toBe(true);
    expect(roundTrips('A. B. C.', 'C. B. A.')).toBe(true);
  });

  it('preserves blank lines, which is what separates paragraphs in prose', () => {
    const before = 'para one\n\npara two';
    expect(roundTrips(before, `${before}\n\npara three`)).toBe(true);
  });

  it('emits nothing but keeps for an unchanged document', () => {
    expect(diffSentences('Same text. More of it.', 'Same text. More of it.')).toEqual([['=', 2]]);
  });

  /* The reason the prefix/suffix trim exists. Appending one sentence to a long document must cost
     one small op, not a rewrite — otherwise a year of daily edits stores the document a year over.
     The `-1` is the paragraph that gained the newline now separating it from the new one: a segment
     owns its own trailing whitespace, so appending always rewrites the segment it is appended to.
     One sentence of churn, not nine hundred. */
  it('keeps a one-sentence append to a long document to a two-unit change', () => {
    const long = Array.from({ length: 900 }, (_, i) => `Paragraph ${i}.`).join('\n');
    const ops = diffSentences(long, `${long}\nAnd one more.`);
    expect(ops).toEqual([
      ['=', 899],
      ['-', 1],
      ['+', ['Paragraph 899.\n', 'And one more.']],
    ]);
  });

  /* Sentence granularity is the whole point: a typo fixed mid-paragraph must touch one sentence,
     where a line diff would have replaced the entire paragraph. */
  it('rewrites one sentence of a paragraph, not the paragraph', () => {
    const before = 'First one. Second one. Third one. Fourth one.';
    expect(diffSentences(before, 'First one. Second ones. Third one. Fourth one.')).toEqual([
      ['=', 1],
      ['-', 1],
      ['+', ['Second ones. ']],
      ['=', 2],
    ]);
  });

  it('coalesces runs rather than emitting one op per unit', () => {
    expect(diffSentences('K. X1. X2. X3. K2.', 'K. K2.')).toEqual([
      ['=', 1],
      ['-', 3],
      ['=', 1],
    ]);
  });

  /* Past the quadratic cap the middle is replaced wholesale. Correctness is the promise;
     compactness is not, and this pins the fallback so a change to the cap can't turn it into a
     hang. */
  it('still round-trips when the changed region is too large to diff', () => {
    const before = Array.from({ length: 1400 }, (_, i) => `A${i}.`).join(' ');
    const after = Array.from({ length: 1400 }, (_, i) => `B${i}.`).join(' ');
    expect(roundTrips(before, after)).toBe(true);
  });

  it('diffs arbitrary unit arrays, which is what the merge builds on', () => {
    expect(diffUnits(['a', 'b'], ['a', 'c'])).toEqual([
      ['=', 1],
      ['-', 1],
      ['+', ['c']],
    ]);
  });

  describe('applyUnitOps tolerance', () => {
    /* A stored chain can legitimately stop lining up — a rename rewrote the document's text, or a
       day's revision was rewritten by a merge. Reading old history must degrade, never crash. */
    it('stops at the end of the source instead of throwing', () => {
      expect(applyUnitOps(['one'], [['=', 50]])).toEqual(['one']);
      expect(applyUnitOps([], [['-', 3]])).toEqual([]);
    });
  });
});
