import { describe, expect, it } from 'vitest';
import { gridWindow, moveInGrid } from './virtualGrid';

describe('gridWindow', () => {
  const base = { count: 100, columns: 8, rowHeight: 40, viewportHeight: 200, overscan: 2 };

  it('renders the rows in view plus the overscan, clamped at the top', () => {
    expect(gridWindow({ ...base, scrollTop: 0 })).toEqual({
      firstRow: 0,
      lastRow: 6, // rows 0–4 visible, two more below
      rows: 13,
      height: 520,
    });
  });

  it('follows the scroll position, clamped at the bottom', () => {
    expect(gridWindow({ ...base, scrollTop: 200 })).toMatchObject({ firstRow: 3, lastRow: 11 });
    expect(gridWindow({ ...base, scrollTop: 400 })).toMatchObject({ firstRow: 8, lastRow: 12 });
  });

  it('counts a part-visible row as visible', () => {
    expect(gridWindow({ ...base, overscan: 0, scrollTop: 20 })).toMatchObject({
      firstRow: 0,
      lastRow: 5,
    });
  });

  it('renders nothing for an empty list, and survives zero columns', () => {
    const empty = gridWindow({ ...base, count: 0, scrollTop: 0 });
    expect(empty.lastRow).toBeLessThan(empty.firstRow);
    expect(gridWindow({ ...base, columns: 0, count: 3, scrollTop: 0 }).rows).toBe(3);
  });
});

describe('moveInGrid', () => {
  const grid = { count: 10, columns: 4, pageRows: 2 };

  it('moves by one cell, wrapping across rows, clamped at the ends', () => {
    expect(moveInGrid(3, 'ArrowRight', grid)).toBe(4);
    expect(moveInGrid(4, 'ArrowLeft', grid)).toBe(3);
    expect(moveInGrid(0, 'ArrowLeft', grid)).toBe(0);
    expect(moveInGrid(9, 'ArrowRight', grid)).toBe(9);
  });

  it('moves by a row, landing on the last icon above a short last row', () => {
    expect(moveInGrid(1, 'ArrowDown', grid)).toBe(5);
    expect(moveInGrid(7, 'ArrowDown', grid)).toBe(9);
    expect(moveInGrid(9, 'ArrowDown', grid)).toBe(9);
    expect(moveInGrid(5, 'ArrowUp', grid)).toBe(1);
    expect(moveInGrid(1, 'ArrowUp', grid)).toBe(1);
  });

  it('jumps to the row ends, or the grid ends with Ctrl', () => {
    expect(moveInGrid(6, 'Home', grid)).toBe(4);
    expect(moveInGrid(5, 'End', grid)).toBe(7);
    expect(moveInGrid(9, 'End', grid)).toBe(9);
    expect(moveInGrid(6, 'Home', { ...grid, ctrl: true })).toBe(0);
    expect(moveInGrid(1, 'End', { ...grid, ctrl: true })).toBe(9);
  });

  it('pages by a screenful of rows', () => {
    expect(moveInGrid(0, 'PageDown', grid)).toBe(8);
    expect(moveInGrid(9, 'PageUp', grid)).toBe(1);
  });

  it('ignores other keys and empty grids', () => {
    expect(moveInGrid(0, 'a', grid)).toBeNull();
    expect(moveInGrid(0, 'ArrowRight', { ...grid, count: 0 })).toBeNull();
  });
});
