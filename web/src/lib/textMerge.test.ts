import { describe, expect, it } from 'vitest';
import { merge3 } from './textMerge';

/* The three-way merge is what replaced last-write-wins for document bodies, so these tests are
   mostly about the thing LWW could not do: telling two people's changes apart well enough to keep
   both. The scenario behind nearly all of them is one document open on a laptop and a phone. */

const clean = (base: string, ours: string, theirs: string) => {
  const result = merge3(base, ours, theirs);
  expect(result.conflicts).toBe(0);
  return result.text;
};

describe('merge3', () => {
  it('takes the side that changed when only one of them did', () => {
    const base = 'A quiet day. Nothing much happened.';
    expect(clean(base, base, 'A quiet day. Nothing much happened. Rain later.')).toBe(
      'A quiet day. Nothing much happened. Rain later.',
    );
    expect(clean(base, 'A quiet day. Plenty happened.', base)).toBe(
      'A quiet day. Plenty happened.',
    );
  });

  /* The one that last-write-wins gets wrong, and the reason all of this exists: two devices editing
     the same document at the same time, in different places. Neither edit may be lost. */
  it('keeps both sides when they changed different sentences', () => {
    const base = 'Met Ana for coffee. She is moving in June. I should help.';
    const ours = 'Met Ana for coffee at the market. She is moving in June. I should help.';
    const theirs = 'Met Ana for coffee. She is moving in June. I should help her pack.';
    expect(clean(base, ours, theirs)).toBe(
      'Met Ana for coffee at the market. She is moving in June. I should help her pack.',
    );
  });

  /* At line granularity this is one changed line and therefore a conflict. Sentences are why it
     isn't one — the whole argument for the unit, in a single case. */
  it('keeps both sides when they changed different sentences of the same paragraph', () => {
    const base = 'One. Two. Three.';
    expect(clean(base, 'One changed. Two. Three.', 'One. Two. Three changed.')).toBe(
      'One changed. Two. Three changed.',
    );
  });

  it('applies an insertion from one side and an edit from the other', () => {
    const base = 'First thought.\n\nSecond thought.';
    const ours = 'First thought, revised.\n\nSecond thought.';
    const theirs = 'First thought.\n\nSecond thought.\n\nThird thought.';
    expect(clean(base, ours, theirs)).toBe(
      'First thought, revised.\n\nSecond thought.\n\nThird thought.',
    );
  });

  it('keeps a deletion made on one side while the other wrote elsewhere', () => {
    const base = 'Keep this. Drop this. Keep this too.';
    expect(
      clean(base, 'Keep this. Keep this too.', 'Keep this. Drop this. Keep this too, twice.'),
    ).toBe('Keep this. Keep this too, twice.');
  });

  it('takes one copy when both sides made the same change', () => {
    const base = 'The meeting is on Tuesday.';
    const both = 'The meeting is on Wednesday.';
    expect(clean(base, both, both)).toBe(both);
  });

  /* The grapheme refinement, which is the difference between "you fixed a typo while I added a
     clause" being a conflict and being a merge. Both edits are inside one sentence. */
  it('merges two edits inside one sentence rather than calling them a conflict', () => {
    const base = 'I met Ana at the cafe.';
    const ours = 'I met Ana at the café.';
    const theirs = 'I met Ana at the cafe on Tuesday.';
    expect(clean(base, ours, theirs)).toBe('I met Ana at the café on Tuesday.');
  });

  /* The other half of that trade. Refining this one leaves `six` against `seven` with nothing to
     anchor on, so the refinement is thrown away whole — the alternative is a spliced word that
     neither device wrote and that nobody can undo. */
  it('keeps both whole sentences when the same words genuinely disagree', () => {
    const base = 'We are meeting at five.';
    const result = merge3(base, 'We are meeting at six.', 'We are meeting at seven.');
    expect(result.conflicts).toBe(1);
    expect(result.text).toContain('at six.');
    expect(result.text).toContain('at seven.');
    // Never spliced together into a word neither side wrote.
    expect(result.text).not.toMatch(/s[ie]xven|sevix/);
  });

  it('puts a conflict on its own line rather than running the two versions together', () => {
    const result = merge3('Start.', 'Left.', 'Right.');
    expect(result.text).toBe('Left.\nRight.');
  });

  /* Japanese: the terminator is `。`, the question mark is `？`, and neither is anywhere in a
     full-stop-based split. If segmentation fell back to `.` these would be one unit and any two
     edits to the note would conflict. */
  it('merges Japanese sentences on their own terminators', () => {
    const base = 'こんにちは。元気ですか？また明日。';
    const ours = 'こんばんは。元気ですか？また明日。';
    const theirs = 'こんにちは。元気ですか？また来週。';
    expect(clean(base, ours, theirs)).toBe('こんばんは。元気ですか？また来週。');
  });

  it('merges Chinese sentences on their own terminators', () => {
    const base = '今天很好。明天见。';
    expect(clean(base, '今天很忙。明天见。', '今天很好。后天见。')).toBe('今天很忙。后天见。');
  });

  it('merges Spanish sentences, including one opened with an inverted mark', () => {
    const base = '¿Cómo estás? Nos vemos pronto. Hasta luego.';
    const ours = '¿Cómo estás hoy? Nos vemos pronto. Hasta luego.';
    const theirs = '¿Cómo estás? Nos vemos pronto. Hasta mañana.';
    expect(clean(base, ours, theirs)).toBe('¿Cómo estás hoy? Nos vemos pronto. Hasta mañana.');
  });

  it('merges a note written in two scripts at once', () => {
    const base = 'Lunch with Ken. 明日は忙しい。Back late.';
    const ours = 'Lunch with Ken at one. 明日は忙しい。Back late.';
    const theirs = 'Lunch with Ken. 明日はとても忙しい。Back late.';
    expect(clean(base, ours, theirs)).toBe('Lunch with Ken at one. 明日はとても忙しい。Back late.');
  });

  describe('the shortcuts, which are also the commonest calls', () => {
    it('is the shared text when the two sides agree', () => {
      expect(merge3('base', 'same', 'same')).toEqual({ text: 'same', conflicts: 0 });
    });

    it('fast-forwards when this device changed nothing', () => {
      expect(merge3('base', 'base', 'theirs')).toEqual({ text: 'theirs', conflicts: 0 });
    });

    it('holds its ground when the server changed nothing', () => {
      expect(merge3('base', 'ours', 'base')).toEqual({ text: 'ours', conflicts: 0 });
    });
  });

  describe('the edges a document actually reaches', () => {
    it('merges writing into a document that was empty', () => {
      expect(clean('', 'First line.', '')).toBe('First line.');
      expect(clean('', '', 'First line.')).toBe('First line.');
    });

    it('keeps both when two devices each started the same empty document', () => {
      const result = merge3('', 'Mine.', 'Theirs.');
      expect(result.conflicts).toBe(1);
      expect(result.text).toBe('Mine.\nTheirs.');
    });

    it('lets one side empty the document while the other did nothing', () => {
      expect(clean('Everything.', '', 'Everything.')).toBe('');
    });

    /* Emptying against editing. Both survive rather than the deletion winning silently: a thought
       cut on one device and extended on the other is not a decision this code gets to make. */
    it('keeps what was written when the other side emptied the document', () => {
      expect(merge3('A thought.', '', 'A longer thought.').text).toBe('A longer thought.');
    });

    it('preserves blank lines, which is what separates paragraphs in prose', () => {
      const base = 'One.\n\nTwo.';
      expect(clean(base, 'One.\n\nTwo.\n\nThree.', base)).toBe('One.\n\nTwo.\n\nThree.');
    });

    it('merges list items as separate units', () => {
      const base = '- milk\n- bread\n- eggs';
      expect(clean(base, '- oat milk\n- bread\n- eggs', '- milk\n- bread\n- eggs\n- coffee')).toBe(
        '- oat milk\n- bread\n- eggs\n- coffee',
      );
    });
  });

  /* Convergence. Both devices run this same function over the same three texts when they race, and
     a merge that depended on which one ran it would leave the two of them trading versions
     forever. The shape is not identical in the conflicted case — the sides are named ours and
     theirs for a reason — but nothing may be *lost* whichever way round it runs. */
  it('keeps every side of a conflict whichever device performs the merge', () => {
    const base = 'Dinner at six.';
    const forward = merge3(base, 'Dinner at seven.', 'Dinner at eight.');
    const reverse = merge3(base, 'Dinner at eight.', 'Dinner at seven.');
    for (const result of [forward, reverse]) {
      expect(result.text).toContain('seven');
      expect(result.text).toContain('eight');
    }
  });

  /* The commonest real collision in a notebook, and the one that used to duplicate text: a segment
     carries its own trailing newline, so two devices appending to a note both "changed the last
     sentence" as well as adding one. Both additions are kept; the sentence they share is not
     kept twice. */
  it('keeps both additions when two devices each wrote at the end of a note', () => {
    const result = merge3('Groceries.', 'Groceries.\nMilk.', 'Groceries.\nBread.');
    expect(result.text).toBe('Groceries.\nMilk.\nBread.');
    expect(result.text.match(/Groceries/g)).toHaveLength(1);
  });

  it('is stable once merged: merging the result back in changes nothing', () => {
    const base = 'One. Two. Three.';
    const ours = 'One changed. Two. Three.';
    const theirs = 'One. Two. Three changed.';
    const merged = clean(base, ours, theirs);
    expect(clean(base, merged, ours)).toBe(merged);
    expect(clean(base, merged, theirs)).toBe(merged);
  });
});
