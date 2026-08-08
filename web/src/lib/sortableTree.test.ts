import { describe, expect, it } from 'vitest';
import {
  applyMove,
  flattenTree,
  projectDrop,
  stepKeyboard,
  visibleForDrag,
  type ArrowKey,
  type KeyboardSlot,
  type TreeNode,
} from './sortableTree';

interface Node extends TreeNode {
  children: Node[];
}

const leaf = (id: string): Node => ({ id, children: [] });
const node = (id: string, children: Node[]): Node => ({ id, children });

/* MAX_SUB_ENTRY_DEPTH is 3 (root = depth 0). Fixture:
   root1 (d0)
     a1 (d1) -> b1 (d2) -> c1 (d3, leaf)
     a2 (d1) -> b2 (d2) -> c2 (d3, leaf)
   root2 (d0, leaf) */
const fixture = (): Node[] => [
  node('root1', [node('a1', [node('b1', [leaf('c1')])]), node('a2', [node('b2', [leaf('c2')])])]),
  leaf('root2'),
];

describe('flattenTree', () => {
  it('walks depth-first, tracking depth and parentId', () => {
    const flat = flattenTree(fixture());
    expect(flat.map((f) => [f.node.id, f.depth, f.parentId])).toEqual([
      ['root1', 0, null],
      ['a1', 1, 'root1'],
      ['b1', 2, 'a1'],
      ['c1', 3, 'b1'],
      ['a2', 1, 'root1'],
      ['b2', 2, 'a2'],
      ['c2', 3, 'b2'],
      ['root2', 0, null],
    ]);
  });
});

describe('visibleForDrag', () => {
  it('excludes the active node and its whole subtree, keeping everything else in order', () => {
    const visible = visibleForDrag(flattenTree(fixture()), 'a1');
    expect(visible.map((f) => f.node.id)).toEqual(['root1', 'a2', 'b2', 'c2', 'root2']);
  });
});

// Resolves `targetIndex`/`activeDepth` the way the provider would: activeDepth is the dragged
// node's original depth, targetIndex is where it'd be inserted into `visible`.
describe('projectDrop', () => {
  const indentWidth = 20;

  it('blocks a depth-3 leaf dropped under an already depth-3 target, but keeps the attempted depth/parent', () => {
    const flat = flattenTree(fixture());
    const active = flat.find((f) => f.node.id === 'c1')!;
    const visible = visibleForDrag(flat, 'c1');
    // Insert right before root2 (i.e. after c2), dragged right one level to nest under c2.
    const targetIndex = visible.findIndex((f) => f.node.id === 'root2');
    const result = projectDrop(
      visible,
      active.node,
      active.depth,
      targetIndex,
      indentWidth,
      indentWidth,
      3,
    );
    // Blocked, but the shadow should stay at depth 4 under c2 — the nesting the user actually
    // reached for — not silently fall back to some other depth.
    expect(result).toEqual({ parentId: 'c2', depth: 4, index: 0, valid: false });
  });

  it('allows that same node dropped under a shallower target', () => {
    const flat = flattenTree(fixture());
    const active = flat.find((f) => f.node.id === 'c1')!;
    const visible = visibleForDrag(flat, 'c1');
    // Insert as a2's first child: before b2, dragged right one level.
    const targetIndex = visible.findIndex((f) => f.node.id === 'b2');
    const result = projectDrop(
      visible,
      active.node,
      active.depth,
      targetIndex,
      indentWidth,
      indentWidth,
      3,
    );
    expect(result).toEqual({ parentId: 'a2', depth: 2, index: 0, valid: true });
  });

  it('allows promoting a depth-3 leaf to root, appended at the end', () => {
    const flat = flattenTree(fixture());
    const active = flat.find((f) => f.node.id === 'c1')!;
    const visible = visibleForDrag(flat, 'c1');
    const result = projectDrop(
      visible,
      active.node,
      active.depth,
      visible.length,
      -3 * indentWidth,
      indentWidth,
      3,
    );
    expect(result).toEqual({ parentId: null, depth: 0, index: 2, valid: true });
  });

  it('blocks a depth-2 node with a child dropped under a depth-2 target, keeping the attempted depth', () => {
    const flat = flattenTree(fixture());
    const active = flat.find((f) => f.node.id === 'b1')!;
    const visible = visibleForDrag(flat, 'b1');
    // Insert as b2's first child: before c2.
    const targetIndex = visible.findIndex((f) => f.node.id === 'c2');
    const result = projectDrop(
      visible,
      active.node,
      active.depth,
      targetIndex,
      indentWidth,
      indentWidth,
      3,
    );
    expect(result).toEqual({ parentId: 'b2', depth: 3, index: 0, valid: false });
  });

  it('blocks that same node dropped under a depth-3 target', () => {
    const flat = flattenTree(fixture());
    const active = flat.find((f) => f.node.id === 'b1')!;
    const visible = visibleForDrag(flat, 'b1');
    const targetIndex = visible.findIndex((f) => f.node.id === 'root2');
    const result = projectDrop(
      visible,
      active.node,
      active.depth,
      targetIndex,
      2 * indentWidth,
      indentWidth,
      3,
    );
    expect(result.valid).toBe(false);
  });

  it('blocks a depth-1 node (with its own descendants) dropped under a depth-3 target', () => {
    const flat = flattenTree(fixture());
    const active = flat.find((f) => f.node.id === 'a1')!;
    const visible = visibleForDrag(flat, 'a1');
    const targetIndex = visible.findIndex((f) => f.node.id === 'root2');
    const result = projectDrop(
      visible,
      active.node,
      active.depth,
      targetIndex,
      3 * indentWidth,
      indentWidth,
      3,
    );
    expect(result.valid).toBe(false);
  });

  it('keeps the same relative position (reorder within siblings) when dropped straight down', () => {
    const flat = flattenTree(fixture());
    const active = flat.find((f) => f.node.id === 'a1')!;
    const visible = visibleForDrag(flat, 'a1');
    // Drop right before a2, no horizontal offset — a plain reorder among root1's children.
    const targetIndex = visible.findIndex((f) => f.node.id === 'a2');
    const result = projectDrop(visible, active.node, active.depth, targetIndex, 0, indentWidth, 3);
    expect(result).toEqual({ parentId: 'root1', depth: 1, index: 0, valid: true });
  });
});

/* The keyboard's contract, which the pointer's doesn't have to meet: a press never lands anywhere
   a drop couldn't happen, the coordinates it implies survive projectDrop's own clamping unchanged
   (ghost and shadow agree), and single presses can reach every position a pointer can. */
describe('stepKeyboard', () => {
  const indentWidth = 20;
  const MAX = 3;

  /** Drive a run of presses from wherever the drag started, as the provider would. */
  const press = (
    visible: ReturnType<typeof visibleForDrag<Node>>,
    active: Node,
    start: KeyboardSlot,
    keys: ArrowKey[],
  ): KeyboardSlot =>
    keys.reduce((slot, key) => stepKeyboard(visible, active, slot, key, MAX), start);

  const setup = (activeId: string) => {
    const flat = flattenTree(fixture());
    const active = flat.find((f) => f.node.id === activeId)!;
    const visible = visibleForDrag(flat, activeId);
    // Where the drag opens, exactly as the provider computes it: however many visible rows
    // precede the dragged node.
    const visibleIds = new Set(visible.map((v) => v.node.id));
    let before = 0;
    for (const f of flat) {
      if (f.node.id === activeId) break;
      if (visibleIds.has(f.node.id)) before += 1;
    }
    return { active, visible, start: { targetIndex: before, depth: active.depth } };
  };

  it('stops at the top instead of running past the first row', () => {
    const { active, visible, start } = setup('a2');
    const slot = press(visible, active.node, start, ['up', 'up', 'up', 'up', 'up', 'up']);
    expect(slot.targetIndex).toBe(0);
  });

  it('stops at the bottom instead of running past the last row', () => {
    const { active, visible, start } = setup('a1');
    const slot = press(visible, active.node, start, Array<ArrowKey>(12).fill('down'));
    expect(slot.targetIndex).toBe(visible.length);
  });

  it('stops at the deepest legal depth instead of nesting past maxDepth', () => {
    // b1 carries c1, so its subtree is 2 tall: under maxDepth 3 it can sit at depth 2 at most.
    const { active, visible, start } = setup('b1');
    const atEnd = press(visible, active.node, start, Array<ArrowKey>(12).fill('down'));
    const slot = press(visible, active.node, atEnd, Array<ArrowKey>(6).fill('right'));
    expect(slot.depth).toBeLessThanOrEqual(2);
    const projected = projectDrop(
      visible,
      active.node,
      active.depth,
      slot.targetIndex,
      (slot.depth - active.depth) * indentWidth,
      indentWidth,
      MAX,
    );
    expect(projected.valid).toBe(true);
  });

  it('never spends a press on travel that has to be paid back', () => {
    const { active, visible, start } = setup('a2');
    // Six lefts from depth 1 can only go one level shallower; one right must undo exactly that.
    const pinned = press(visible, active.node, start, Array<ArrowKey>(6).fill('left'));
    const back = press(visible, active.node, pinned, ['right']);
    expect(pinned.depth).toBe(0);
    expect(back.depth).toBe(1);
  });

  it('lands the ghost where the shadow already is, on every reachable slot', () => {
    // The alignment guarantee: converting a slot to a drag offset and back through projectDrop —
    // the exact round trip the provider performs — has to return the same depth it was given.
    for (const activeId of ['a1', 'b1', 'c1', 'a2', 'root2']) {
      const { active, visible, start } = setup(activeId);
      for (const slot of reachable(visible, active.node, start)) {
        const projected = projectDrop(
          visible,
          active.node,
          active.depth,
          slot.targetIndex,
          (slot.depth - active.depth) * indentWidth,
          indentWidth,
          MAX,
        );
        expect({ id: activeId, ...slot, depth: projected.depth }).toEqual({
          id: activeId,
          ...slot,
        });
      }
    }
  });

  it('can reach every position a pointer drag could legally drop on', () => {
    const unreachable: string[] = [];
    let checked = 0;
    for (const activeId of ['a1', 'b1', 'c1', 'a2', 'root2']) {
      const { active, visible, start } = setup(activeId);
      const reached = new Set(
        reachable(visible, active.node, start).map((s) => `${s.targetIndex}:${s.depth}`),
      );
      // Sweep every slot and every depth, keep the ones a pointer drag would actually resolve to
      // and could drop on, and check the arrow keys can get to each.
      for (let targetIndex = 0; targetIndex <= visible.length; targetIndex++) {
        for (let depth = 0; depth <= MAX; depth++) {
          const projected = projectDrop(
            visible,
            active.node,
            active.depth,
            targetIndex,
            (depth - active.depth) * indentWidth,
            indentWidth,
            MAX,
          );
          if (!projected.valid || projected.depth !== depth) continue;
          checked += 1;
          if (!reached.has(`${targetIndex}:${depth}`)) {
            unreachable.push(`${activeId} @ ${targetIndex}:${depth}`);
          }
        }
      }
    }
    expect(unreachable).toEqual([]);
    expect(checked).toBeGreaterThan(20); // the sweep found real positions, not an empty set
  });
});

/** Every slot reachable from `start` by any sequence of arrow presses.
    The cap is a tripwire, not a limit: the reachable set is bounded by
    (visible.length + 1) x (maxDepth + 1), so blowing past it means stepKeyboard stopped
    clamping — which would otherwise search an unbounded space and hang the suite. */
function reachable(
  visible: ReturnType<typeof visibleForDrag<Node>>,
  active: Node,
  start: KeyboardSlot,
): KeyboardSlot[] {
  const limit = (visible.length + 1) * 4 * 4;
  const seen = new Map<string, KeyboardSlot>();
  const queue: KeyboardSlot[] = [start];
  seen.set(`${start.targetIndex}:${start.depth}`, start);
  while (queue.length) {
    const slot = queue.shift()!;
    for (const key of ['up', 'down', 'left', 'right'] as ArrowKey[]) {
      const next = stepKeyboard(visible, active, slot, key, 3);
      const id = `${next.targetIndex}:${next.depth}`;
      if (seen.has(id)) continue;
      if (seen.size >= limit)
        throw new Error(`stepKeyboard reached ${id}: unbounded, not clamping`);
      seen.set(id, next);
      queue.push(next);
    }
  }
  return [...seen.values()];
}

describe('applyMove', () => {
  it('moves a node (with its subtree) to a new parent at the given index', () => {
    const result = applyMove(fixture(), 'c1', 'a2', 0);
    const a2 = result[0].children.find((n) => n.id === 'a2')!;
    expect(a2.children.map((n) => n.id)).toEqual(['c1', 'b2']);
    // Removed cleanly from its old spot.
    const a1 = result[0].children.find((n) => n.id === 'a1')!;
    expect(a1.children[0].children).toEqual([]);
  });

  it('promotes a node to root at the given index', () => {
    const result = applyMove(fixture(), 'a1', null, 2);
    expect(result.map((n) => n.id)).toEqual(['root1', 'root2', 'a1']);
    // Its own subtree moved with it, untouched.
    expect(result[2]).toMatchObject({
      id: 'a1',
      children: [{ id: 'b1', children: [{ id: 'c1' }] }],
    });
  });
});
