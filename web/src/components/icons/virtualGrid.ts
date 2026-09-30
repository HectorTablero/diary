/**
 * The arithmetic behind the icon picker's virtualised grid.
 *
 * A grid of equal square cells is the easy case of virtualisation — every row is the same height, so
 * which rows are on screen is a division rather than a measurement — and that is why this is a
 * dozen lines here rather than a dependency. Kept apart from the component so it can be tested
 * without a layout engine, which jsdom does not have.
 */

export interface GridWindow {
  /** First and last row to render, inclusive. `lastRow < firstRow` when there is nothing. */
  firstRow: number;
  lastRow: number;
  rows: number;
  /** Height of the whole grid, rendered or not — what makes the scrollbar honest. */
  height: number;
}

export function gridWindow({
  count,
  columns,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan,
}: {
  count: number;
  columns: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  /** Rows rendered beyond each edge, so a quick flick doesn't show blank space. */
  overscan: number;
}): GridWindow {
  const cols = Math.max(1, columns);
  const rows = Math.ceil(count / cols);
  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const lastVisible = Math.ceil((Math.max(0, scrollTop) + viewportHeight) / rowHeight) - 1;
  return {
    firstRow: Math.max(0, firstVisible - overscan),
    lastRow: Math.min(rows - 1, lastVisible + overscan),
    rows,
    height: rows * rowHeight,
  };
}

/**
 * Where a key press moves the active cell to, or null for a key the grid doesn't handle.
 *
 * The same moves a native grid makes: arrows by one cell, Home/End to the ends of the row (or of the
 * whole grid with Ctrl), PageUp/PageDown by a screenful of rows. Left and right wrap across rows,
 * because a grid of icons reads as one long list that happens to be folded.
 */
export function moveInGrid(
  index: number,
  key: string,
  {
    count,
    columns,
    pageRows,
    ctrl = false,
  }: { count: number; columns: number; pageRows: number; ctrl?: boolean },
): number | null {
  if (count === 0) return null;
  const cols = Math.max(1, columns);
  const last = count - 1;
  const clamp = (value: number) => Math.min(last, Math.max(0, value));
  const rowStart = index - (index % cols);

  switch (key) {
    case 'ArrowRight':
      return clamp(index + 1);
    case 'ArrowLeft':
      return clamp(index - 1);
    case 'ArrowDown':
      // Down from a cell above the short last row lands on the last icon rather than nowhere.
      return index + cols <= last ? index + cols : rowStart + cols <= last ? last : index;
    case 'ArrowUp':
      return index - cols >= 0 ? index - cols : index;
    case 'Home':
      return ctrl ? 0 : rowStart;
    case 'End':
      return ctrl ? last : clamp(rowStart + cols - 1);
    case 'PageDown':
      return clamp(index + cols * Math.max(1, pageRows));
    case 'PageUp':
      return clamp(index - cols * Math.max(1, pageRows));
    default:
      return null;
  }
}
