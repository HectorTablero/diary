import { describe, expect, it } from 'vitest';
import { planCaretScroll, type CaretView } from './caret';

/* The rule that decides where the line being written sits on screen.
 *
 * Pure on purpose: jsdom has no layout, so `getBoundingClientRect` is all zeros and a hook test
 * could only ever assert that nothing happened. Everything that is actually a *decision* is in
 * here, and the hook around it is plumbing — when to look, and how to find the caret.
 *
 * The scene throughout: a phone-sized screen with the keyboard up, so 600px of usable height under
 * a 60px status bar, and 24px lines. The target line is 42% down that band — 60 + 252 = 312. */
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
    expect(planCaretScroll(view())).toEqual({ scrollBy: 0, shortfall: 0 });
  });

  /* The complaint, in one assertion. Writing at the bottom of the screen is what a browser's own
     "scroll it into view" leaves you with; this is what replaces it. */
  it('pulls a caret at the bottom of the screen back to the middle', () => {
    const plan = planCaretScroll(view({ caretY: 650 }));
    expect(plan.scrollBy).toBe(650 - TARGET);
    expect(plan.shortfall).toBe(0);
  });

  /* Typing a new line moves the caret one line down, and the page follows by exactly that much —
     which is what makes this read as a typewriter rather than as a page that jumps every so often. */
  it('follows a new line by one line, not by a jump', () => {
    expect(planCaretScroll(view({ caretY: TARGET + LINE })).scrollBy).toBe(LINE);
  });

  it('ignores a caret sitting just under the target, so nothing jitters', () => {
    expect(planCaretScroll(view({ caretY: TARGET + LINE / 2 })).scrollBy).toBe(0);
  });

  describe('going the other way', () => {
    /* Deleting lines, or arrowing up through a paragraph, must not drag the page down after every
       keystroke — the text is supposed to come up to meet you. */
    it('leaves a caret above the target alone while it stays clear of the top', () => {
      expect(planCaretScroll(view({ caretY: TARGET - 100 })).scrollBy).toBe(0);
      expect(planCaretScroll(view({ caretY: 200 })).scrollBy).toBe(0);
    });

    it('pulls one back down once it reaches the top of the screen', () => {
      // 25% of 600 above the target line is the limit; 150px above it is over.
      const plan = planCaretScroll(view({ caretY: TARGET - 200 }));
      expect(plan.scrollBy).toBe(-200);
    });
  });

  describe('when the page has run out', () => {
    /* The last line of a document, which is where writing spends most of its time and the one case
       scrolling alone cannot fix: there is nothing below it to bring into view. */
    it('reports what it could not scroll rather than silently giving up', () => {
      const plan = planCaretScroll(view({ caretY: 650, scrollY: 4980, maxScroll: 5000 }));
      expect(plan.scrollBy).toBe(20); // all the page had left
      expect(plan.shortfall).toBe(650 - TARGET - 20);
    });

    it('asks for nothing when the page can supply the whole scroll', () => {
      expect(planCaretScroll(view({ caretY: 650, scrollY: 0, maxScroll: 5000 }))).toMatchObject({
        shortfall: 0,
      });
    });

    it('never scrolls the page above its top', () => {
      const plan = planCaretScroll(view({ caretY: TARGET - 200, scrollY: 30 }));
      expect(plan.scrollBy).toBe(-30);
      // Nothing is owed upwards: the top of a document is a place the caret is allowed to be.
      expect(plan.shortfall).toBe(0);
    });
  });

  /* A phone in landscape with the keyboard up, or a browser window dragged very short. Nothing to
     centre within, and no arithmetic that would divide by it. */
  it('does nothing when there is no usable screen at all', () => {
    expect(planCaretScroll(view({ band: { top: 300, bottom: 300 } }))).toEqual({
      scrollBy: 0,
      shortfall: 0,
    });
  });

  /* The band, not the window: on a phone the keyboard takes the bottom half and the tab bar takes a
     strip below that, so "the middle" is the middle of what is left. */
  it('centres within the usable band rather than within the window', () => {
    const plan = planCaretScroll(view({ caretY: 400, band: { top: 0, bottom: 300 } }));
    expect(plan.scrollBy).toBe(400 - 300 * 0.42);
  });
});
