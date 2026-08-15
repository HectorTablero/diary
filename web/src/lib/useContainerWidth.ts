import { useCallback, useLayoutEffect, useState, type RefCallback } from 'react';

/**
 * Measures an element's own rendered width and keeps it live via ResizeObserver.
 *
 * Tailwind's `lg:`/`xl:` variants key off the *viewport*, which is not the same number as the
 * space actually available to an element sitting next to a sidebar, capped by a `max-w-*`, or
 * sharing a grid track with something else — a 1024px window says nothing about how wide a column
 * that is 5 of 12 grid tracks inside it turns out to be. Measuring the element itself is the only
 * way a layout decision matches the room it actually has, including the sidebar, its own
 * max-width, and (on desktop) an arbitrarily resized or snapped window.
 *
 * A callback ref, not a plain `useRef` + `useLayoutEffect(..., [])`: the element this attaches to
 * is routinely the tail end of a loading branch (a skeleton renders first, the real list swaps in
 * once data arrives) rather than something present on the component's very first commit. An
 * effect with an empty dependency array only ever runs once, against whatever `ref.current` was at
 * that first commit — null, for anything gated behind a loading state — and never fires again once
 * the real element actually mounts, so the width stays 0 and the layout stays narrow forever. A
 * callback ref is invoked by React on every mount *of the node itself*, so swapping the skeleton
 * for the list re-triggers this hook correctly.
 *
 * `useLayoutEffect` rather than `useEffect`: it runs before the browser paints, so the first frame
 * already reflects the real width instead of flashing the narrow default and then jumping.
 * jsdom's ResizeObserver stub (test/setup.ts) never calls back, so tests only ever see the
 * `getBoundingClientRect()` read — 0 in jsdom, which is the correct "assume narrow" fallback.
 */
export function useContainerWidth<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  const ref = useCallback<RefCallback<T>>((el) => setNode(el), []);

  useLayoutEffect(() => {
    if (!node) return;

    setWidth(node.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [ref, width];
}

/**
 * `useContainerWidth`, collapsed to the one question most call sites actually have: is there
 * enough of *this element's own* width to switch a list from one column to two (or a sidebar
 * split from stacked to side-by-side)? Kept as a boolean rather than the raw number so call sites
 * can't accidentally re-derive their own slightly-different threshold logic per page.
 */
export function useIsWideContainer<T extends HTMLElement>(
  minWidth: number,
): [RefCallback<T>, boolean] {
  const [ref, width] = useContainerWidth<T>();
  return [ref, width >= minWidth];
}

/* The main/aside split needs real room for *both* sides — e.g. 7 grid tracks of prose next to 5 of
   cards — not just "the aside can fit". 760px of actually-rendered content width is roughly what
   that took at the old lg: breakpoint once the sidebar and page padding were accounted for; below
   it the two columns would be too narrow. WIDE_GAP is the point the extra breathing room (gap-8
   over gap-6) stops feeling cramped. Shared by every page built from a 7/5 main/aside split — the
   day page's entries/plugins layout, the person profile's tabs/events layout — so the two don't
   silently drift to different thresholds for what is, mechanically, the same layout. */
export const SIDEBAR_SPLIT_MIN_WIDTH = 760;
export const SIDEBAR_SPLIT_WIDE_GAP_MIN_WIDTH = 1100;

/** Shared minimum width for switching a simple card/row list to two columns. Tuned for rows built
    from a leading icon/avatar plus a line or two of text (tags, period cycles) — two of those
    comfortably fit by ~640px of real container width. Denser rows (a person's row of badges, a
    habit's 21-day grid) want more room per column; those pages pass their own, larger minimum —
    but still comfortably under ~700px, which is roughly all `PageContainer`'s default max-w-3xl
    (768px) leaves once its padding is subtracted. A page that never widens its own PageContainer
    can't measure past that ceiling, so a per-page minimum has to stay under it or two columns
    would be a mode the page can never actually reach. */
export const LIST_TWO_COLUMN_MIN = 640;

/**
 * A list split into two independent front/back halves, for a two-column layout built from two
 * separate single-column flows rather than a CSS grid.
 *
 * Deliberately not `grid-cols-2` with items placed in source order: a CSS grid lays every item
 * into a row, and a row's height is its *tallest* cell — so a card that expands (a disclosure, a
 * "show more") drags its same-row neighbour in the other column taller with it, even though the
 * two have nothing to do with each other. Two plain flex columns have no row to be coupled
 * through: each item's height is only ever its own, and the columns' total heights are free to
 * differ. The trade-off is that source order runs down column one, then down column two — the
 * same order a browser's own `columns-2` balancing would produce, and legible for lists that are
 * already sorted (alphabetically, most-recent-first) — rather than the left-right-left-right order
 * a grid would give a raw `.map()`.
 */
export function splitColumns<T>(items: readonly T[]): [T[], T[]] {
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
}
