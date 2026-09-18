/**
 * Where a textarea's caret actually is, and keeping it somewhere comfortable to write at.
 *
 * A textarea will not tell you where its caret is. There is no API for it — but this editor never
 * needed one, because it already keeps a second copy of its text laid out glyph for glyph beneath
 * the textarea: the highlight layer (MentionTextarea.tsx), whose whole contract is that every
 * character sits exactly where the textarea draws it. So the caret is found in that copy, by
 * measuring the character beside it. It is used twice in this plugin — to hang the `@mention` popup
 * off the caret rather than off the bottom edge, and to keep the caret near the middle of the screen
 * while writing.
 *
 * This used to lay the text out a *third* time, in a hidden mirror div built for each measurement.
 * That was accurate, and it cost a full layout of the document per call — a few milliseconds at ten
 * thousand characters, tens of them near the size limit — which is why the centring hook rationed
 * its measurements, and the rationing is what let the caret slip off the bottom of a long page (see
 * useCaretCentering.ts). The layer is laid out for painting anyway, so asking it costs a walk over
 * its text nodes and one rect.
 */

/** How to find a caret by measuring the text around it — decided from the source alone, so it can be
    tested without a layout. */
export interface CaretProbe {
  /** Source offsets of the characters to measure. `null` when only newlines come before the caret. */
  range: [number, number] | null;
  /** Whether the caret sits at those characters' left edge (they follow it) or right (they lead up
      to it). */
  edge: 'left' | 'right';
  /** How many lines below the measured characters' line the caret is — non-zero only on an empty
      line, which has no character of its own to measure. */
  linesBelow: number;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/* One character, whole. An emoji is two UTF-16 code units, and half of one has no glyph to measure. */
const charFrom = (text: string, at: number): [number, number] => [
  at,
  at + (isHighSurrogate(text.charCodeAt(at)) && isLowSurrogate(text.charCodeAt(at + 1)) ? 2 : 1),
];
const charBefore = (text: string, end: number): [number, number] => [
  end -
    (isLowSurrogate(text.charCodeAt(end - 1)) && isHighSurrogate(text.charCodeAt(end - 2)) ? 2 : 1),
  end,
];

/**
 * Which character to measure for a caret at `index`.
 *
 * The one after it when there is one on the same line — which is also where a textarea draws a
 * caret sitting at a soft wrap: at the start of the next line, beside the character that begins it.
 * Otherwise the one before it (the end of a line, or of the document). A newline itself is never
 * measured: it has no glyph, and what a browser reports for one varies. On an empty line there is
 * nothing on either side, so the last character above it is measured and the newlines in between
 * are counted down from there — each is exactly one line, since nothing between them can wrap.
 */
export function caretProbe(text: string, index: number): CaretProbe {
  if (index < text.length && text[index] !== '\n') {
    return { range: charFrom(text, index), edge: 'left', linesBelow: 0 };
  }
  if (index > 0 && text[index - 1] !== '\n') {
    return { range: charBefore(text, index), edge: 'right', linesBelow: 0 };
  }
  let last = index - 1;
  while (last >= 0 && text[last] === '\n') last--;
  const linesBelow = index - 1 - last;
  return last < 0
    ? { range: null, edge: 'left', linesBelow }
    : { range: charBefore(text, last + 1), edge: 'right', linesBelow };
}

/**
 * The first box the layer draws source characters `[from, to)` in, in viewport coordinates.
 *
 * Text inside `[data-overlay-only]` is not source — a reference's title painted over its raw id, the
 * trailing character that gives an empty last line its height — and is skipped, which is what keeps
 * the offsets counted here equal to offsets in the textarea's value.
 */
function measureSource(layer: HTMLElement, from: number, to: number): DOMRect | null {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('[data-overlay-only]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const range = document.createRange();
  let seen = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && from < seen + length) {
      range.setStart(node, from - seen);
      started = true;
    }
    if (started && to <= seen + length) {
      range.setEnd(node, to - seen);
      // Absent in jsdom, which has no geometry at all.
      return typeof range.getClientRects === 'function'
        ? (range.getClientRects()[0] ?? null)
        : null;
    }
    seen += length;
  }
  return null;
}

/** Where the caret at `index` sits inside the layer's box, in CSS pixels: the top of its line's
    glyphs, and its horizontal position. `text` must be what the layer is currently showing. */
export function caretPosition(
  layer: HTMLElement,
  text: string,
  index: number,
): { top: number; left: number } {
  const probe = caretProbe(text, index);
  let top = 0;
  let left = 0;
  if (probe.range) {
    const rect = measureSource(layer, ...probe.range);
    if (rect) {
      const origin = layer.getBoundingClientRect();
      top = rect.top - origin.top;
      left = (probe.edge === 'left' ? rect.left : rect.right) - origin.left;
    }
  }
  if (probe.linesBelow > 0) {
    top += probe.linesBelow * (parseFloat(window.getComputedStyle(layer).lineHeight) || 0);
    left = 0;
  }
  return { top, left };
}

/**
 * The slice of the screen a caret can comfortably sit in, in layout-viewport coordinates.
 *
 * Two things make this not simply "the window". On a phone the on-screen keyboard takes the bottom
 * half and `window.innerHeight` does not notice — `visualViewport` is the only thing that reports
 * what is actually visible, and on iOS it also reports how far the visual viewport has been shifted
 * up inside the layout one, which every `getBoundingClientRect` in here is relative to. And the tab
 * bar is `position: fixed` at the bottom, so it covers whatever is behind it whether or not the
 * keyboard is up.
 *
 * The bar is measured rather than assumed from its height: it is hidden outright on a wide screen
 * in the browser build, and `display: none` reports a zero-sized rect, which is exactly the "nothing
 * in the way" answer wanted.
 */
export function usableBand(): { top: number; bottom: number } {
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  let bottom = top + (viewport?.height ?? window.innerHeight);
  const bar = document.querySelector('[data-bottom-bar]')?.getBoundingClientRect();
  if (bar && bar.height > 0) bottom = Math.min(bottom, bar.top);
  return { top, bottom };
}

/* --- Keeping the caret somewhere comfortable ------------------------------------------------- */

/** Where the caret should sit, as a fraction of the usable height. Slightly above the true middle:
    what you are about to write matters more than what you just wrote. */
const TARGET = 0.42;
/** How far above the target the caret may drift before it is pulled back down. */
const UPPER_SLACK = 0.25;

/** Everything `planCaretScroll` needs, in layout-viewport coordinates. */
export interface CaretView {
  /** The middle of the caret's own line, so a tall line is centred rather than its top edge. */
  caretY: number;
  band: { top: number; bottom: number };
  lineHeight: number;
  scrollY: number;
  /** How far the page can be scrolled — `scrollHeight` less the viewport. */
  maxScroll: number;
}

/**
 * How far to scroll the page to bring the caret back to a comfortable line — `0` to leave it be.
 *
 * The rule is asymmetric, and deliberately so.
 *
 * **Below the target line, the caret is pulled back to it always.** That is the case this exists
 * for: a browser scrolls a caret into view *minimally*, which leaves it on the last visible line —
 * invisible in a one-line composer, and the whole experience in a full-page editor, where you end
 * up writing along the bottom edge with everything you have written above you and nothing below.
 * Correcting every line rather than only when the caret escapes some band is what keeps it smooth:
 * writing scrolls the page a line at a time, like a typewriter, with no periodic jump.
 *
 * **Above the target line, it is left alone until it nears the top of the screen.** Clicking into
 * the third paragraph of a long thought should not throw the page around, and deleting lines should
 * let the text come up to meet you. Only a caret that has drifted into the top sixth is pulled back
 * down — which is roughly where a browser would have scrolled it anyway.
 *
 * **The page is only ever scrolled, never extended.** Near the end of a document there may not be
 * enough page left below the caret to bring it all the way up, and then it goes as far as the page
 * allows and stops. This once made up the difference with blank room under the editor, which meant
 * a click near the bottom of a document could push everything below it down the page — the space
 * between the editor and what follows it is not the caret's to change. The target is a preference
 * for where to write, not a promise worth moving the layout for.
 */
export function planCaretScroll(view: CaretView): number {
  const { caretY, band, lineHeight, scrollY, maxScroll } = view;
  const usable = band.bottom - band.top;
  if (usable <= 0) return 0;

  const delta = caretY - (band.top + usable * TARGET);
  // Half a line of dead zone below, so a caret already on the target line is left exactly alone.
  if (delta <= lineHeight / 2 && delta >= -usable * UPPER_SLACK) return 0;

  return Math.max(-scrollY, Math.min(delta, maxScroll - scrollY));
}
