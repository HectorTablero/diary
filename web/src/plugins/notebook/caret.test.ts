import { describe, expect, it } from 'vitest';
import { caretProbe, planCaretScroll, type CaretView } from './caret';

/* The two decisions behind keeping the line being written somewhere comfortable: where the caret
 * is, and whether the page should move to bring it back.
 *
 * Pure on purpose: jsdom has no layout, so `getBoundingClientRect` is all zeros and a hook test
 * could only ever assert that nothing happened. Everything that is actually a *decision* is in
 * here, and the hook around it is plumbing — when to look, and what to measure.
 *
 * The scene for the scroll rule: a phone-sized screen with the keyboard up, so 600px of usable height
 * under a 60px status bar, and 24px lines. The target line is 42% down that band — 60 + 252 = 312. */
const LINE = 24;
const view = (patch: Partial<CaretView> = {}): CaretView => ({
  caretY: 312,
  band: { top: 60, bottom: 660 },
  lineHeight: LINE,
  scrollY: 1000,
  maxScroll: 5000,
  ...patch,
});

const TARGET = 312;

describe('planCaretScroll', () => {
  it('leaves a caret already on the target line exactly alone', () => {
    expect(planCaretScroll(view())).toBe(0);
  });

  /* The complaint, in one assertion. Writing at the bottom of the screen is what a browser's own
     "scroll it into view" leaves you with; this is what replaces it. */
  it('pulls a caret at the bottom of the screen back to the middle', () => {
    expect(planCaretScroll(view({ caretY: 650 }))).toBe(650 - TARGET);
  });

  /* Typing a new line moves the caret one line down, and the page follows by exactly that much —
     which is what makes this read as a typewriter rather than as a page that jumps every so often. */
  it('follows a new line by one line, not by a jump', () => {
    expect(planCaretScroll(view({ caretY: TARGET + LINE }))).toBe(LINE);
  });

  it('ignores a caret sitting just under the target, so nothing jitters', () => {
    expect(planCaretScroll(view({ caretY: TARGET + LINE / 2 }))).toBe(0);
  });

  describe('going the other way', () => {
    /* Deleting lines, or arrowing up through a paragraph, must not drag the page down after every
       keystroke — the text is supposed to come up to meet you. */
    it('leaves a caret above the target alone while it stays clear of the top', () => {
      expect(planCaretScroll(view({ caretY: TARGET - 100 }))).toBe(0);
      expect(planCaretScroll(view({ caretY: 200 }))).toBe(0);
    });

    it('pulls one back down once it reaches the top of the screen', () => {
      // 25% of 600 above the target line is the limit; 200px above it is over.
      expect(planCaretScroll(view({ caretY: TARGET - 200 }))).toBe(-200);
    });
  });

  describe('when the page has run out', () => {
    /* The last lines of a document, where there may not be enough page below the caret to bring it
       all the way up. It goes as far as the page does and no further: the room it would take to
       reach the target is never added, because adding it moves everything below the editor. */
    it('scrolls as far as the page allows and stops there', () => {
      expect(planCaretScroll(view({ caretY: 650, scrollY: 4980, maxScroll: 5000 }))).toBe(20);
    });

    it('leaves the page alone when it is already at its end', () => {
      expect(planCaretScroll(view({ caretY: 650, scrollY: 5000, maxScroll: 5000 }))).toBe(0);
    });

    it('never scrolls the page above its top', () => {
      expect(planCaretScroll(view({ caretY: TARGET - 200, scrollY: 30 }))).toBe(-30);
    });
  });

  /* A phone in landscape with the keyboard up, or a browser window dragged very short. Nothing to
     centre within, and no arithmetic that would divide by it. */
  it('does nothing when there is no usable screen at all', () => {
    expect(planCaretScroll(view({ band: { top: 300, bottom: 300 } }))).toBe(0);
  });

  /* The band, not the window: on a phone the keyboard takes the bottom half and the tab bar takes a
     strip below that, so "the middle" is the middle of what is left. */
  it('centres within the usable band rather than within the window', () => {
    expect(planCaretScroll(view({ caretY: 400, band: { top: 0, bottom: 300 } }))).toBe(
      400 - 300 * 0.42,
    );
  });
});

/* Which character the caret is measured by. The layer draws text, not carets, so a caret is found by
   the glyph beside it — and a newline has no glyph, so the interesting cases are all about lines. */
describe('caretProbe', () => {
  it('measures the character after the caret when there is one on its line', () => {
    expect(caretProbe('hello', 2)).toEqual({ range: [2, 3], edge: 'left', linesBelow: 0 });
    // The start of a line, just after a newline, is still "a character after it".
    expect(caretProbe('a\nbc', 2)).toEqual({ range: [2, 3], edge: 'left', linesBelow: 0 });
  });

  it('measures the character before it at the end of a line or of the document', () => {
    expect(caretProbe('hello', 5)).toEqual({ range: [4, 5], edge: 'right', linesBelow: 0 });
    expect(caretProbe('ab\ncd', 2)).toEqual({ range: [1, 2], edge: 'right', linesBelow: 0 });
  });

  /* An empty line has nothing on it to measure. Counting down from the last character above works
     because every line between them is a bare newline, and a bare newline can't wrap. */
  it('counts down from the last character above an empty line', () => {
    expect(caretProbe('abc\n', 4)).toEqual({ range: [2, 3], edge: 'right', linesBelow: 1 });
    expect(caretProbe('abc\n\n\nnext', 5)).toEqual({
      range: [2, 3],
      edge: 'right',
      linesBelow: 2,
    });
  });

  it('counts from the top when only newlines come before it', () => {
    expect(caretProbe('', 0)).toEqual({ range: null, edge: 'left', linesBelow: 0 });
    expect(caretProbe('\n\n', 2)).toEqual({ range: null, edge: 'left', linesBelow: 2 });
  });

  /* An emoji is two UTF-16 code units, and a range over half of one has no glyph to report. */
  it('never splits an emoji', () => {
    expect(caretProbe('🌱x', 0)).toEqual({ range: [0, 2], edge: 'left', linesBelow: 0 });
    expect(caretProbe('x🌱', 3)).toEqual({ range: [1, 3], edge: 'right', linesBelow: 0 });
    expect(caretProbe('🌱\n', 3)).toEqual({ range: [0, 2], edge: 'right', linesBelow: 1 });
  });
});
