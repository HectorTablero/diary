/**
 * Where a textarea's caret actually is, and keeping it somewhere comfortable to write at.
 *
 * A textarea will not tell you where its caret is. There is no API for it, and the only technique
 * that works is the one below: lay the same text out again, in a hidden div wearing the textarea's
 * own typography, and ask *that* where the split falls. It is used twice in this plugin — to hang
 * the `@mention` popup off the caret rather than off the bottom edge, and to keep the caret near
 * the middle of the screen while writing.
 */

/** The properties a mirror must copy for its line breaks to fall where the textarea's do. */
const MIRRORED_STYLES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-indent',
  'text-transform',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'box-sizing',
] as const;

/** Where the caret sits inside the textarea's box, in CSS pixels, scroll accounted for. */
export function caretOffset(
  textarea: HTMLTextAreaElement,
  index: number,
): { top: number; left: number } {
  const mirror = document.createElement('div');
  const computed = window.getComputedStyle(textarea);
  for (const property of MIRRORED_STYLES) {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  }
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.width = `${textarea.clientWidth}px`;

  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  /* The rest of the text goes *inside* the marker so the marker wraps exactly as the real text
     does. Without it a caret at the end of a line would measure at the start of the next one. A
     full stop stands in for an empty tail, since a zero-width span has no position to report. */
  marker.textContent = textarea.value.slice(index) || '.';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const top = marker.offsetTop - textarea.scrollTop;
  const left = marker.offsetLeft;
  mirror.remove();
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

export interface CaretScrollPlan {
  /** Pixels to scroll the page by. Already clamped to what the page can actually do. */
  scrollBy: number;
  /** Scroll the page could not supply, for the caller to add as room below the editor. */
  shortfall: number;
}

/**
 * Whether the page should move to bring the caret back to a comfortable line, and by how much.
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
 * The last line of a document is the case that cannot be satisfied by scrolling: there is nothing
 * below it to bring into view, which is exactly why writing has always ended up at the bottom edge.
 * That shortfall is reported rather than silently dropped, so the caller can make the room.
 */
export function planCaretScroll(view: CaretView): CaretScrollPlan {
  const { caretY, band, lineHeight, scrollY, maxScroll } = view;
  const usable = band.bottom - band.top;
  const still: CaretScrollPlan = { scrollBy: 0, shortfall: 0 };
  if (usable <= 0) return still;

  const delta = caretY - (band.top + usable * TARGET);
  // Half a line of dead zone below, so a caret already on the target line is left exactly alone.
  if (delta <= lineHeight / 2 && delta >= -usable * UPPER_SLACK) return still;

  return {
    scrollBy: Math.max(-scrollY, Math.min(delta, maxScroll - scrollY)),
    shortfall: Math.max(0, Math.ceil(scrollY + delta - maxScroll)),
  };
}
