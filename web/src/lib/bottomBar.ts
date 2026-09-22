/**
 * How much of the bottom of the window the tab bar covers, in px — `0` wherever it isn't shown.
 *
 * The bar is `position: fixed`, so the window's own bottom edge is *behind* it: anything that
 * clamps itself to "the bottom of the screen" (a select list growing a scrollbar, a popover
 * deciding whether to flip) has to treat the bar's top edge as that bottom instead. Measured rather
 * than assumed, for the same reason `usableBand` in the notebook measures it: the bar is
 * `display: none` on a wide screen in the browser build, and a zero rect is exactly the right answer
 * there.
 */
export function bottomBarHeight(): number {
  if (typeof document === 'undefined') return 0;
  const bar = document.querySelector('[data-bottom-bar]')?.getBoundingClientRect();
  if (!bar || bar.height === 0) return 0;
  return Math.max(0, window.innerHeight - bar.top);
}

/** The breathing room a floating panel keeps from the edges of the usable screen. */
export const FLOATING_EDGE_PADDING = 8;

type Side = 'top' | 'right' | 'bottom' | 'left';
export type CollisionPadding = number | Partial<Record<Side, number>>;

/**
 * A Radix `collisionPadding` that keeps a floating panel clear of the screen edges *and* of the tab
 * bar: the requested padding on every side, with the bar's height added to the bottom one. Radix
 * derives `--radix-*-content-available-height` from this too, so a list that has to scroll starts
 * scrolling above the bar rather than disappearing behind it.
 */
export function collisionPaddingAboveBar(
  padding: CollisionPadding = FLOATING_EDGE_PADDING,
): Record<Side, number> {
  const sides =
    typeof padding === 'number'
      ? { top: padding, right: padding, bottom: padding, left: padding }
      : { top: 0, right: 0, bottom: 0, left: 0, ...padding };
  return { ...sides, bottom: sides.bottom + bottomBarHeight() };
}
