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

/* The three below complete the same id -> parentId view of a tree, so a caller holding that one map
   can answer every question the drag rules ask. They exist because the server was answering them
   with its own walks instead — one database round-trip per level for depth, a breadth-first query
   per level for height and for descendants — which duplicated the arithmetic above in a second
   place that no test covered, and made the two halves of one rule free to disagree.

   All three tolerate a cycle in the map. Storage should never contain one (that is what
   isSelfOrDescendant is for), but a corrupt row must not hang the process. */

/** Number of ancestors above `id`; a root sits at depth 0. */
export function depthOf(id: string, parentById: ReadonlyMap<string, string | null>): number {
  let depth = 0;
  let current = parentById.get(id) ?? null;
  const seen = new Set<string>([id]);
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = parentById.get(current) ?? null;
  }
  return depth;
}

/** Every id below `id`, excluding `id` itself. */
export function descendantIds(
  id: string,
  parentById: ReadonlyMap<string, string | null>,
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const [child, parent] of parentById) {
    if (parent === null) continue;
    const siblings = childrenByParent.get(parent);
    if (siblings) siblings.push(child);
    else childrenByParent.set(parent, [child]);
  }

  const found = new Set<string>();
  const frontier = [id];
  while (frontier.length) {
    for (const child of childrenByParent.get(frontier.pop()!) ?? []) {
      if (found.has(child)) continue; // cycle guard
      found.add(child);
      frontier.push(child);
    }
  }
  return found;
}

/** Height of the subtree rooted at `id`, counting `id` itself: a leaf is 1. */
export function subtreeHeightFrom(
  id: string,
  parentById: ReadonlyMap<string, string | null>,
): number {
  const descendants = descendantIds(id, parentById);
  if (descendants.size === 0) return 1;
  // The tallest descendant's depth, measured from `id` rather than from the root.
  const base = depthOf(id, parentById);
  let tallest = 0;
  for (const descendant of descendants) {
    tallest = Math.max(tallest, depthOf(descendant, parentById) - base);
  }
  return tallest + 1;
}
