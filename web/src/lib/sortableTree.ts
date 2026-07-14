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
export function visibleForDrag<T extends TreeNode>(flat: FlatNode<T>[], activeId: string): FlatNode<T>[] {
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
  const previousItem = visible[targetIndex - 1];
  const nextItem = visible[targetIndex];

  // How deep the pointer's horizontal offset requests, clamped to what's structurally possible
  // at this position: no deeper than "child of the previous row," no shallower than "sibling of
  // the next row" (going shallower than that would skip past it in the list).
  const requestedDepth = activeDepth + Math.round(dragOffsetX / indentWidth);
  const maxAllowed = previousItem ? previousItem.depth + 1 : 0;
  const minAllowed = nextItem ? nextItem.depth : 0;
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
