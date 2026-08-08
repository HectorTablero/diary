import { subtreeHeight, wouldExceedMaxDepth } from '@diary/shared';

/* Pure tree math for drag-and-drop reorder/reparent, generic over any {id, children}-shaped
   node so it works identically for the real entry tree (Dexie-backed) and the voice-suggestions
   review modal's in-memory DraftNode tree (no persistence at all until accept). No React, no
   dnd-kit types — the provider component in components/tree/ is what wires this to pointer
   events and a DragOverlay. */

export interface TreeNode {
  id: string;
  children: TreeNode[];
}

export interface FlatNode<T extends TreeNode> {
  node: T;
  /** 0-based; a root sits at depth 0, matching EntryItem's `depth` prop. */
  depth: number;
  parentId: string | null;
}

/** Depth-first flatten of the whole forest. Call once when a drag starts (not per pointer move —
    it walks every node) and reuse the result for every projectDrop call during that drag. */
export function flattenTree<T extends TreeNode>(roots: T[]): FlatNode<T>[] {
  const result: FlatNode<T>[] = [];
  const walk = (nodes: T[], depth: number, parentId: string | null) => {
    for (const node of nodes) {
      result.push({ node, depth, parentId });
      walk(node.children as T[], depth + 1, node.id);
    }
  };
  walk(roots, 0, null);
  return result;
}

/** The flat list with `activeId` and its own subtree removed — the set of valid reference points
    for a drop. Call once at drag start; reuse the same array for every projectDrop call and for
    measuring row rects, so the vertical target index and the projected parent/depth are computed
    against the exact same, stable ordering for the whole drag. */
export function visibleForDrag<T extends TreeNode>(
  flat: FlatNode<T>[],
  activeId: string,
): FlatNode<T>[] {
  const active = flat.find((f) => f.node.id === activeId);
  if (!active) return flat;
  const excluded = new Set<string>();
  const collect = (node: T) => {
    excluded.add(node.id);
    for (const child of node.children as T[]) collect(child);
  };
  collect(active.node);
  return flat.filter((f) => !excluded.has(f.node.id));
}

export interface DropProjection {
  parentId: string | null;
  /** The depth actually being attempted at this pointer position, whether or not it's valid —
      callers use this to keep the shadow at the depth the user is reaching for even when
      blocked, rather than falling back to some other depth (that reads as "why is it blocking
      me here?" instead of "this specific nesting is too deep"). */
  depth: number;
  /** Index among the new parent's children (or among the roots, when parentId is null). Only
      meaningful when `valid` is true. */
  index: number;
  /** False when landing here would push some node past maxDepth. Callers render the shadow in a
      blocked state (still at `depth`/`parentId`) and must not call onMove with this result. */
  valid: boolean;
}

/** How deep a drop at `targetIndex` may sit, structurally: no deeper than "child of the previous
    row", and no shallower than "sibling of the next row" (going shallower than that would skip
    past it in the list). Shared by the pointer projection and the keyboard stepper so the two can
    never disagree about which depths a given slot even offers. */
function structuralDepthBounds<T extends TreeNode>(
  visible: FlatNode<T>[],
  targetIndex: number,
): { min: number; max: number } {
  const previousItem = visible[targetIndex - 1];
  const nextItem = visible[targetIndex];
  return { min: nextItem ? nextItem.depth : 0, max: previousItem ? previousItem.depth + 1 : 0 };
}

/**
 * The depths an arrow-key move may select at `targetIndex`: the structural range above, further
 * capped at the deepest one that doesn't push the dragged subtree past `maxDepth`.
 *
 * A pointer drag deliberately projects *past* that cap, so the shadow can sit at the depth the
 * user is physically reaching for and turn red there (see DropProjection.depth) — the gesture is
 * continuous, and snapping it back would read as the drag fighting the hand. A keyboard has no
 * reach to express: each press is one discrete step, so a step onto a depth that can never be
 * dropped on is simply a key press that does nothing visible but still has to be undone with the
 * opposite key. Stepping stops at the last droppable depth instead.
 *
 * When even `min` is over the cap the range collapses onto it. That slot has no legal depth at
 * all, and it stays reachable, blocked, rather than becoming a hole in the vertical travel.
 */
function keyboardDepthBounds<T extends TreeNode>(
  visible: FlatNode<T>[],
  activeNode: T,
  targetIndex: number,
  maxDepth?: number,
): { min: number; max: number } {
  const { min, max } = structuralDepthBounds(visible, targetIndex);
  const height = subtreeHeight(activeNode);
  for (let depth = max; depth > min; depth--) {
    // Same expression projectDrop validates with, so the cap can't drift from `valid`.
    if (!wouldExceedMaxDepth(depth - 1, height, maxDepth)) return { min, max: depth };
  }
  return { min, max: min };
}

/** Where a keyboard drag currently sits: the same pair a pointer drag resolves to from pixels. */
export interface KeyboardSlot {
  /** 0..visible.length, as projectDrop's `targetIndex`. */
  targetIndex: number;
  depth: number;
}

export type ArrowKey = 'up' | 'down' | 'left' | 'right';

/**
 * The slot one arrow-key press moves to.
 *
 * This is the keyboard's whole model of the drag. A pointer drag carries a position that is free
 * to wander anywhere, including nowhere legal, and gets clamped only when it is read; stepping
 * from *slot to slot* instead means the position is never anywhere a drop couldn't happen, so
 * there is no dead travel to pay back and nothing for the ghost and the shadow to disagree about.
 * The caller's job is only to convert the returned slot back into coordinates.
 *
 * Both axes are clamped on every press, whichever key it was: a vertical move can land somewhere
 * the current depth isn't on offer, and that has to resolve here rather than in projectDrop, or
 * the coordinates would stay pointing at a depth the projection quietly drops.
 */
export function stepKeyboard<T extends TreeNode>(
  visible: FlatNode<T>[],
  activeNode: T,
  current: KeyboardSlot,
  key: ArrowKey,
  maxDepth?: number,
): KeyboardSlot {
  const vertical = key === 'up' || key === 'down';
  const step = key === 'down' || key === 'right' ? 1 : -1;
  const targetIndex = vertical
    ? Math.min(Math.max(current.targetIndex + step, 0), visible.length)
    : current.targetIndex;
  const { min, max } = keyboardDepthBounds(visible, activeNode, targetIndex, maxDepth);
  const requestedDepth = vertical ? current.depth : current.depth + step;
  return { targetIndex, depth: Math.min(Math.max(requestedDepth, min), max) };
}

/**
 * Where would a drop land, given `targetIndex` (0..visible.length — "insert before this position
 * in `visible`") and the pointer's horizontal offset from where the drag started (positive =
 * dragged right = deeper — "drag right to become a child" is the standard tree-DnD gesture)?
 * `targetIndex` is resolved by the caller from real row rects (comparing the dragged ghost's
 * center against each visible row's midpoint) rather than from any collision/hover detection —
 * that's what makes this stable even right at a row boundary, unlike overlap-based hit-testing.
 *
 * Always returns a projection — check `.valid` rather than a null result, so the shadow can stay
 * at the attempted depth/parent even when blocked (see DropProjection.depth). This is the single
 * choke point invalid-drop blocking flows through for both tree surfaces.
 */
export function projectDrop<T extends TreeNode>(
  visible: FlatNode<T>[],
  activeNode: T,
  /** The dragged node's own depth before the drag started — the baseline requestedDepth offsets
      from. */
  activeDepth: number,
  targetIndex: number,
  dragOffsetX: number,
  indentWidth: number,
  maxDepth?: number,
): DropProjection {
  const requestedDepth = activeDepth + Math.round(dragOffsetX / indentWidth);
  return projectAtDepth(visible, activeNode, targetIndex, requestedDepth, maxDepth);
}

/**
 * The projection itself, from a depth that has already been decided rather than from a pointer
 * offset — `projectDrop` is just this with the pixels converted first.
 *
 * Split out because the keyboard has no pointer offset to convert: it picks a depth outright (see
 * stepKeyboard) and needs the same parent/index/validity answer for it. Routing both inputs
 * through one function is what keeps a keyboard drop and the pointer drop it looks identical to
 * from landing anywhere different.
 */
export function projectAtDepth<T extends TreeNode>(
  visible: FlatNode<T>[],
  activeNode: T,
  targetIndex: number,
  requestedDepth: number,
  maxDepth?: number,
): DropProjection {
  const previousItem = visible[targetIndex - 1];

  // Clamped to what's structurally possible at this position.
  const { min: minAllowed, max: maxAllowed } = structuralDepthBounds(visible, targetIndex);
  const depth = Math.min(Math.max(requestedDepth, minAllowed), maxAllowed);

  let parentId: string | null = null;
  if (depth > 0) {
    if (previousItem && depth === previousItem.depth) {
      parentId = previousItem.parentId;
    } else if (previousItem && depth > previousItem.depth) {
      parentId = previousItem.node.id;
    } else {
      // Shallower than the previous row: walk back to the nearest earlier row at this exact
      // depth and reuse its parent (that's who else is a sibling at this depth here).
      for (let i = targetIndex - 1; i >= 0; i--) {
        if (visible[i].depth === depth) {
          parentId = visible[i].parentId;
          break;
        }
      }
    }
  }

  const targetParentDepth = parentId === null ? -1 : depth - 1;
  const valid = !wouldExceedMaxDepth(targetParentDepth, subtreeHeight(activeNode), maxDepth);

  let index = 0;
  for (const item of visible.slice(0, targetIndex)) {
    if (item.parentId === parentId) index += 1;
  }

  return { parentId, depth, index, valid };
}

/** Rebuild the nested tree with `activeId` removed from wherever it was and reinserted as a
    child of `newParentId` (or as a root, when null) at `newIndex`. Its own subtree moves with
    it, untouched. Used by both tree surfaces' onDragEnd, fed by projectDrop's result. */
export function applyMove<T extends TreeNode>(
  roots: T[],
  activeId: string,
  newParentId: string | null,
  newIndex: number,
): T[] {
  let removed: T | undefined;
  const remove = (nodes: T[]): T[] => {
    const kept: T[] = [];
    for (const node of nodes) {
      if (node.id === activeId) {
        removed = node;
        continue;
      }
      kept.push({ ...node, children: remove(node.children as T[]) } as T);
    }
    return kept;
  };
  const withoutActive = remove(roots);
  if (!removed) return roots;

  const insertAt = (nodes: T[]): T[] => {
    const next = [...nodes];
    next.splice(Math.min(newIndex, next.length), 0, removed as T);
    return next;
  };

  if (newParentId === null) return insertAt(withoutActive);

  const insertUnderParent = (nodes: T[]): T[] =>
    nodes.map((node) =>
      node.id === newParentId
        ? ({ ...node, children: insertAt(node.children as T[]) } as T)
        : ({ ...node, children: insertUnderParent(node.children as T[]) } as T),
    );
  return insertUnderParent(withoutActive);
}
