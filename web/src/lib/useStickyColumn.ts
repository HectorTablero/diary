import {
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefCallback,
} from 'react';
import { bottomBarHeight } from '@/lib/bottomBar';

/** Gap kept above a column pinned to the top of the screen, and below one pinned to the bottom. */
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
 * - shorter than the screen → `top: 24px`, pinned at the top like before;
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
      const room = window.innerHeight - bottomBarHeight() - STICKY_GAP;
      setTop(Math.min(STICKY_GAP, room - node.offsetHeight));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [node, enabled]);

  return [ref, enabled ? { position: 'sticky', top } : undefined];
}
