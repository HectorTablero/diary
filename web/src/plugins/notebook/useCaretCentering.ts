import { useCallback, useEffect, useRef, useState } from 'react';
import { caretOffset, planCaretScroll, usableBand } from './caret';

/**
 * Keep the line being written near the middle of the screen instead of at the bottom edge.
 *
 * The rule itself is `planCaretScroll` in caret.ts, which is where the reasoning lives and is pure
 * enough to have tests. This is the plumbing around it: when to look, how to find the caret, and
 * what to do with an answer the page is too short to satisfy.
 *
 * ## When it looks
 *
 * Measuring the caret means laying the whole document out a second time, in a mirror — for a long
 * thought that is the difference between a free keystroke and one you can feel. So ordinary typing
 * is gated on the box having *changed height*: a character added inside a line cannot move the
 * caret's line, and one that wraps onto a new line grows the box, so wrapping is caught by the same
 * test. Everything that moves the caret without touching the text — an arrow key, a click, focus,
 * the keyboard opening — asks for a measurement explicitly.
 *
 * ## The blank space underneath
 *
 * The last line of a document has nothing below it to scroll into view. When the plan comes back
 * short, that shortfall is returned as `spacer` for the caller to leave as room under the editor.
 *
 * It only ever grows while writing, and is dropped on blur. Shrinking it as the caret moves back up
 * would move the page under someone who is doing nothing at all, and the ceiling means no mistake
 * in here can leave more than a screenful of nothing at the bottom of a document.
 */

/** Ceiling on the blank space below the editor, as a fraction of the usable height. */
const MAX_SPACER = 0.75;

/** Keys that move the caret without changing the text, so the height gate cannot see them. */
const CARET_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function useCaretCentering(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  /** False while the preview is showing, when there is no caret to follow. */
  enabled: boolean,
): number {
  const [spacer, setSpacer] = useState(0);
  const frameRef = useRef<number | null>(null);
  /** The box's height as of the last measurement — see "When it looks", above. */
  const heightRef = useRef(0);
  /** Set when something moved the caret without touching the text, so the height gate is wrong. */
  const forcedRef = useRef(false);

  const adjust = useCallback(() => {
    const el = textareaRef.current;
    if (!el || el !== document.activeElement) return;

    const forced = forcedRef.current;
    forcedRef.current = false;
    const height = el.offsetHeight;
    const grew = height !== heightRef.current;
    heightRef.current = height;
    if (!forced && !grew) return;

    const band = usableBand();
    const styles = window.getComputedStyle(el);
    const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.5 || 24;
    const box = el.getBoundingClientRect();

    const plan = planCaretScroll({
      caretY: box.top + caretOffset(el, el.selectionStart ?? 0).top + lineHeight / 2,
      band,
      lineHeight,
      scrollY: window.scrollY,
      maxScroll: Math.max(0, (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight),
    });

    if (plan.shortfall > 0) {
      const ceiling = Math.round((band.bottom - band.top) * MAX_SPACER);
      // Grown to the high-water mark, and the effect below finishes the scroll once it is rendered.
      setSpacer((held) => Math.min(Math.max(held, plan.shortfall), ceiling));
    }
    /* `instant`, not `auto`: `auto` defers to the `scroll-behavior` CSS property, so one stylesheet
       turning on smooth scrolling would leave every new line chasing a caret that had already moved
       on. This is a correction, not a transition. */
    if (plan.scrollBy !== 0) window.scrollBy({ top: plan.scrollBy, behavior: 'instant' });
  }, [textareaRef]);

  /* One measurement per frame at most. Every trigger below fires either during an event, before
     React has re-rendered, or before the layout effect that resizes the box has run — so none of
     the numbers are trustworthy until the frame is over. */
  const schedule = useCallback(
    (force = false) => {
      forcedRef.current ||= force;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        adjust();
      });
    },
    [adjust],
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !enabled) return;

    const onInput = () => schedule();
    const onKeyUp = (event: KeyboardEvent) => {
      if (CARET_KEYS.has(event.key)) schedule(true);
    };
    const onPointer = () => schedule(true);
    const onFocus = () => {
      heightRef.current = el.offsetHeight;
      schedule(true);
    };
    const onBlur = () => setSpacer(0);
    /* The keyboard opening is a resize of the visual viewport and of nothing else — no scroll, no
       input, no React render — and it is the moment the usable height halves. Without this, the
       first thing anyone sees on a phone is the caret pinned just above the keyboard, which is the
       complaint this hook exists for. */
    const onViewport = () => schedule(true);

    el.addEventListener('input', onInput);
    el.addEventListener('keyup', onKeyUp);
    el.addEventListener('click', onPointer);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    window.visualViewport?.addEventListener('resize', onViewport);
    // Autofocus fires before this effect attaches, so the first focus would otherwise be missed.
    if (el === document.activeElement) onFocus();

    return () => {
      el.removeEventListener('input', onInput);
      el.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('click', onPointer);
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
      window.visualViewport?.removeEventListener('resize', onViewport);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [textareaRef, enabled, schedule]);

  // The room asked for on the last pass has been rendered; finish the scroll it was short of.
  useEffect(() => {
    if (spacer > 0) schedule(true);
  }, [spacer, schedule]);

  // Nothing to follow in the preview, and a gap left under it would be unexplainable.
  useEffect(() => {
    if (!enabled) setSpacer(0);
  }, [enabled]);

  return enabled ? spacer : 0;
}
