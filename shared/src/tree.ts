import { MAX_SUB_ENTRY_DEPTH } from './constants';

/* Generic tree structure math for drag-and-drop reorder/reparent, shared verbatim by the API,
   the local-first client's write guard, and the client's in-memory drag projection so all three
   agree on what's legal without duplicating the arithmetic. Deliberately decoupled from
   EntryDto/parentId-shaped storage — the voice-suggestions review modal drags a plain in-memory
   `DraftNode[]` tree that never touches Dexie/Mongo, and these helpers work identically for it. */

export interface HeightNode {
  children: HeightNode[];
}

/** Height of an in-memory subtree: a leaf (no children) is 1. */
export function subtreeHeight<T extends HeightNode>(node: T): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map((child) => subtreeHeight(child)));
}

/**
 * Would dropping a subtree of the given height under a parent at the given depth push any of
 * its descendants past maxDepth? Depth convention: a root node sits at depth 0 (matching
 * EntryItem's `depth` prop and entryService's assertDepthAllowed); pass -1 for a root-level drop
 * (no parent), which can never trip this for any legal height.
 */
export function wouldExceedMaxDepth(
  targetParentDepth: number,
  movedSubtreeHeight: number,
  maxDepth: number = MAX_SUB_ENTRY_DEPTH,
): boolean {
  return targetParentDepth + movedSubtreeHeight > maxDepth;
}

/**
 * Cycle guard: is `candidateId` the same node as `nodeId`, or one of its descendants? Walks
 * `candidateId`'s ancestor chain via the caller-supplied id -> parentId map. Call this with the
 * proposed new parent as `candidateId` and the node being moved as `nodeId` — true means the move
 * would make a node its own ancestor, which must be rejected regardless of depth.
 */
export function isSelfOrDescendant(
  candidateId: string,
  nodeId: string,
  parentById: ReadonlyMap<string, string | null>,
): boolean {
  let current: string | null | undefined = candidateId;
  while (current !== null && current !== undefined) {
    if (current === nodeId) return true;
    current = parentById.get(current) ?? null;
  }
  return false;
}
