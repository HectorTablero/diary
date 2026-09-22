import {
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefCallback,
} from 'react';
import { bottomBarHeight } from '@/lib/bottomBar';

/** Gap kept below a column pinned to the bottom of the screen. */
const STICKY_GAP = 24;

/**
 * One column of a side-by-side split that scrolls with the page until its own end is on screen, and
 * then stays put while the other, longer column carries on.
 *
 * A plain `sticky top-6` only works for a column shorter than the screen: a taller one pins its top
 * and hides its own bottom forever. And leaving the columns unpinned means a long plugin column next
 * to two entries scrolls the entries away and leaves a screen of empty space beside the plugins. So
 * the `top` offset is worked out from the column's height instead:
 *
 * - fits on screen → `top` is where it already rests with the page scrolled to the top, so it
 *   never moves at all (a fixed `top-6` let it creep up by the height of the header first);
 * - taller → a negative `top` that puts its bottom edge 24px above the bottom of the screen (or of
 *   the tab bar), so it scrolls normally until its last card comes into view and then holds there.
 *
 * Given to *both* columns, since either can be the short one — the taller of the two is as tall as
 * the grid row, so `sticky` has no room to move it and it scrolls like any other content.
 */
export function useStickyColumn<T extends HTMLElement>(
  enabled: boolean,
): [RefCallback<T>, CSSProperties | undefined] {
  const [node, setNode] = useState<T | null>(null);
  const [top, setTop] = useState(STICKY_GAP);
  const ref = useCallback<RefCallback<T>>((el) => setNode(el), []);

  useLayoutEffect(() => {
    if (!node || !enabled) return;
    const update = () => {
      /* Where the column rests before any scrolling, measured off the grid rather than the column
         itself — the column's own rect already includes whatever offset `sticky` has given it. */
      const grid = node.parentElement ?? node;
      const restingTop = grid.getBoundingClientRect().top + window.scrollY;
      const room = window.innerHeight - bottomBarHeight() - STICKY_GAP;
      setTop(Math.min(restingTop, room - node.offsetHeight));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    // Content above the split (a banner appearing, the header wrapping) moves where it rests
    // without resizing it, but it does resize the page.
    observer.observe(document.body);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [node, enabled]);

  return [ref, enabled ? { position: 'sticky', top } : undefined];
}
