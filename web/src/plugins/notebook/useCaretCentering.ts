import { useCallback, useEffect, useRef } from 'react';
import { caretPosition, planCaretScroll, usableBand } from './caret';

/**
 * Keep the line being written near the middle of the screen instead of at the bottom edge.
 *
 * The rule itself is `planCaretScroll` in caret.ts, which is where the reasoning lives and is pure
 * enough to have tests. This is the plumbing around it: when to look, and how to find the caret.
 *
 * ## When it looks: after anything that could have moved the caret on screen
 *
 * Every input, every caret key, every click, focus, and the on-screen keyboard opening.
 *
 * Input used to count only when the editor had changed height, on the theory that a character typed
 * inside a line cannot move that line. True of the line's place in the *document*, and beside the
 * point: what this keeps steady is the line's place on the *screen*, and the page moves under a
 * caret without its line changing at all. The browser runs its own scroll-into-view on every
 * keystroke, which parks the caret on the bottom edge, and on a long document that is exactly what
 * the gate let stand — the caret ended up at, or behind, the bottom of the screen. The gate existed
 * because measuring the caret was a full layout of the document; it no longer is (see caret.ts), so
 * there is nothing left to ration. On the other side of the keystroke, a caret already on its line
 * costs one measurement and no scroll.
 *
 * ## Where it listens
 *
 * On `document`, filtered to this textarea, rather than on the textarea itself. The editor renders a
 * skeleton until its document has loaded, so the textarea arrives a render or two after this hook
 * first runs — and listeners attached to `ref.current` in an effect keyed on the ref *object* found
 * nothing there and were never retried. The caret was followed only after something happened to
 * re-run the effect, like a trip to the preview and back.
 *
 * ## What it never does
 *
 * Add room. Near the end of a document the page may not reach far enough to bring the caret all the
 * way up, and then it is left as high as the page allows — see `planCaretScroll`.
 */

/** Keys that move the caret without changing the text, so no `input` event reports them. */
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
  /** The highlight layer under the textarea — the copy of the text the caret is measured in. */
  layerRef: React.RefObject<HTMLElement | null>,
  /** False while the preview is showing, when there is no caret to follow. */
  enabled: boolean,
): void {
  const frameRef = useRef<number | null>(null);

  const adjust = useCallback(() => {
    const el = textareaRef.current;
    const layer = layerRef.current;
    if (!el || !layer || el !== document.activeElement) return;

    const styles = window.getComputedStyle(el);
    const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.5 || 24;
    const caret = caretPosition(layer, el.value, el.selectionStart ?? 0);

    const scrollBy = planCaretScroll({
      caretY: layer.getBoundingClientRect().top + caret.top + lineHeight / 2,
      band: usableBand(),
      lineHeight,
      scrollY: window.scrollY,
      maxScroll: Math.max(0, (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight),
    });
    /* `instant`, not `auto`: `auto` defers to the `scroll-behavior` CSS property, so one stylesheet
       turning on smooth scrolling would leave every new line chasing a caret that had already moved
       on. This is a correction, not a transition. */
    if (scrollBy !== 0) window.scrollBy({ top: scrollBy, behavior: 'instant' });
  }, [textareaRef, layerRef]);

  /* One measurement per frame at most, and never during the event itself: every trigger below fires
     before React has re-rendered the layer with the new text, so nothing is measurable until then.
     Running in the frame callback also means the correction lands before the browser paints, so the
     bottom edge the browser's own scroll-into-view left the caret on is never actually seen. */
  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      adjust();
    });
  }, [adjust]);

  useEffect(() => {
    if (!enabled) return;

    const ours = (event: Event) => event.target !== null && event.target === textareaRef.current;
    const onEvent = (event: Event) => {
      if (ours(event)) schedule();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (ours(event) && CARET_KEYS.has(event.key)) schedule();
    };
    /* The keyboard opening is a resize of the visual viewport and of nothing else — no scroll, no
       input, no React render — and it is the moment the usable height halves. Without this, the
       first thing anyone sees on a phone is the caret pinned just above the keyboard, which is the
       complaint this hook exists for. */
    const onViewport = () => schedule();

    const events = ['input', 'click', 'focusin'] as const;
    for (const type of events) document.addEventListener(type, onEvent);
    document.addEventListener('keyup', onKeyUp);
    window.visualViewport?.addEventListener('resize', onViewport);
    // Focus may have landed before this ran (autofocus, or coming back from the preview).
    schedule();

    return () => {
      for (const type of events) document.removeEventListener(type, onEvent);
      document.removeEventListener('keyup', onKeyUp);
      window.visualViewport?.removeEventListener('resize', onViewport);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [textareaRef, enabled, schedule]);
}
