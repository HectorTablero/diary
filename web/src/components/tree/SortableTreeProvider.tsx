import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import { motion } from 'framer-motion';
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  flattenTree,
  projectDrop,
  visibleForDrag,
  type DropProjection,
  type FlatNode,
  type TreeNode,
} from '@/lib/sortableTree';
import { hapticTap, hapticWarning } from '@/lib/haptics';
import { cn } from '@/lib/utils';

/* Drag-and-drop for a nested tree, generic over any {id, children}-shaped node — used by both
   the main diary entry tree (EntryItem/EntryTree) and the voice-suggestions review modal
   (SuggestionNodeEditor).

   Earlier versions of this file built the reflow/reparent animation on @dnd-kit/sortable
   (SortableContext + useSortable's per-row transform). That's the wrong tool for a NESTED tree —
   its sorting strategies assume every id in one SortableContext is a flat sibling, and its
   collision-based "over" detection gets ambiguous once a parent row and its own nested children
   are adjacent droppables. Both caused real, reported bugs (rows flickering invalid near the
   cursor, drops reverting, a dimmed original row left in its old spot with its action buttons
   still floating). This version drops @dnd-kit/sortable entirely:

   - The dragged node's row is REMOVED from the list the instant a drag starts (not dimmed in
     place) — DragOverlay shows a cursor-following ghost of it instead, exactly tracking the
     pointer with no snapping.
   - Where it WOULD land is a separate "shadow" placeholder spliced into a flattened, temporarily-
     rendered list at the resolved target position — indented to the projected depth, styled
     red/dashed when that depth is blocked. Every row (including the shadow) is wrapped in
     framer-motion's `motion.*` with `layout`, so the whole list reflows with a smooth FLIP
     animation as the target position changes, matching real sibling adjacency instead of a
     flat-list assumption.
   - The target position is resolved from real row rects captured once at drag start (comparing
     the dragged ghost's current center against each row's midpoint — the same idea as a
     hand-rolled reorderable list), not from dnd-kit's collision/hover detection — so there's
     nothing left to flicker.
   - Only @dnd-kit/core's useDraggable is used per row now (for pointer/touch activation via the
     grip handle, and DragOverlay for the ghost) — no useDroppable, no collision detection. */

interface SortableTreeContextValue {
  activeId: string | null;
  /** Which row (if any) the shadow would currently become a child of — null means "would land
      at the root level." Rows compare their own id against this to highlight themselves as the
      projected parent (see useSortableTreeRow's isProjectedParent). */
  projectedParentId: string | null;
  /** Whether the current projection is a legal depth — drives whether the projected-parent
      highlight reads as "landing here" vs. "blocked here." */
  projectionValid: boolean;
}

const SortableTreeContext = createContext<SortableTreeContextValue | null>(null);

/** True while any drag is active in this tree — rows use this to disable hover/press styling and
    pointer interaction entirely for the duration (matching the shadow-based drag model: nothing
    but the ghost and the shadow should visually react while dragging). */
export function useSortableTreeDragActive(): boolean {
  return useContext(SortableTreeContext)?.activeId !== null;
}

export interface SortableTreeRowState {
  /** Put on the row's own root element — this is what gets measured for the drag (its rect at
      drag start becomes the ghost's starting position and the row-height used by the shadow). */
  setNodeRef: (el: HTMLElement | null) => void;
  /** Spread only onto the grip handle, never the row — dragging must only ever start from there. */
  dragHandleProps: Record<string, unknown>;
  /** True while this row is the node the shadow would currently be nested under — indentation
      alone doesn't say *which* row at that depth is the parent when there are several, so rows
      use this to highlight themselves as "the shadow's new owner." */
  isProjectedParent: boolean;
  /** True when isProjectedParent is true but the depth is actually blocked — same row, different
      (red) highlight, so "this would be the parent" and "but it's not allowed" are both visible
      on the row itself, not just on the shadow. */
  isProjectedParentInvalid: boolean;
}

/** Call from a row component (e.g. EntryItem) to wire it into the enclosing SortableTreeProvider.
    The row must also carry `data-tree-row-id={nodeId}` on the same element as `setNodeRef`, so
    the provider can measure every row's rect at drag start (see the file-level comment). */
export function useSortableTreeRow(nodeId: string): SortableTreeRowState {
  const ctx = useContext(SortableTreeContext);
  const { attributes, listeners, setNodeRef } = useDraggable({ id: nodeId });
  const isProjectedParent = ctx?.projectedParentId === nodeId;
  return {
    setNodeRef,
    // No tabIndex: there's no keyboard sensor wired up, and a *pointer* click still focuses a
    // <button> in most browsers — leaving the default tabIndex 0 meant dragging a row left its
    // handle permanently focused, which kept that row's :focus-within action buttons visible.
    dragHandleProps: { ...attributes, ...listeners, tabIndex: -1 },
    isProjectedParent,
    isProjectedParentInvalid: isProjectedParent && !ctx?.projectionValid,
  };
}

const SPRING = { type: 'spring', damping: 32, stiffness: 420 } as const;

// Nudges the drag ghost above a touch point so a finger doesn't cover it; mice get no offset.
const ghostOffsetModifier: Modifier = ({ transform }) => {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  return coarse ? { ...transform, y: transform.y - 56 } : transform;
};

interface DragData<T extends TreeNode> {
  activeNode: T;
  activeDepth: number;
  visible: FlatNode<T>[];
  /** Y midpoint of each `visible` row's rect at drag start, in the same order — compared against
      the ghost's live center to resolve the target index, replacing collision detection. */
  midpoints: number[];
  rowHeight: number;
}

export interface SortableTreeProviderProps<T extends TreeNode> {
  roots: T[];
  onMove: (activeId: string, newParentId: string | null, newIndex: number) => void;
  /** One row's content, rendered flat (no recursion) at the given depth — used only for the
      other, reflowing rows while a drag is active. Must carry the same
      data-tree-row-id/useSortableTreeRow wiring as the idle rendering. */
  renderRow: (node: T, depth: number) => ReactNode;
  /** Compact preview of the dragged node, shown in the cursor-following DragOverlay ghost. */
  renderGhost: (node: T) => ReactNode;
  /** Horizontal px per depth level — must match the row markup's actual indent so dragging left/
      right maps to the same depth changes the user sees, and the shadow lines up with real rows. */
  indentWidth: number;
  /** className applied to the flat <div> rendered during a drag — pass whatever your own idle
      list wrapper (inside `children`) uses, so nothing visibly shifts when a drag starts/ends. */
  listClassName?: string;
  /** True when rows stack with no gap between them (e.g. the main entry tree), so the shadow's
      top border would sit exactly on the previous row's projected-parent ring/border when it's
      about to become that row's first child — both semi-transparent, so the overlap reads as one
      solid seam. Only then does the shadow drop its own top border there. Surfaces with real
      spacing between rows (e.g. the voice-suggestions modal's gap-4/gap-2) don't touch in the
      first place, so leave this false there or the border just looks like it's missing. */
  denseRows?: boolean;
  maxDepth?: number;
  /** Idle-state markup — your own nested tree (unchanged, e.g. recursive EntryItem/<ul>). */
  children: ReactNode;
}

export function SortableTreeProvider<T extends TreeNode>({
  roots,
  onMove,
  renderRow,
  renderGhost,
  indentWidth,
  listClassName,
  denseRows = false,
  maxDepth,
  children,
}: SortableTreeProviderProps<T>) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [targetIndex, setTargetIndex] = useState(0);
  const [projection, setProjection] = useState<DropProjection | null>(null);
  const dragDataRef = useRef<DragData<T> | null>(null);
  const projectionRef = useRef<DropProjection | null>(null);
  const wasInvalidRef = useRef(false);
  // Tracks the last (index, depth) the drag resolved to, so a light tap fires whenever it
  // actually changes — a subtle "still moving, here's your new slot" tick, distinct from the
  // pickup/drop taps and the invalid-transition warning buzz below.
  const lastSlotKeyRef = useRef<string | null>(null);

  const reset = () => {
    setActiveId(null);
    setProjection(null);
    dragDataRef.current = null;
    projectionRef.current = null;
    wasInvalidRef.current = false;
    lastSlotKeyRef.current = null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const flat = flattenTree(roots);
    const activeFlat = flat.find((f) => f.node.id === id);
    if (!activeFlat) return;
    const visible = visibleForDrag(flat, id);
    const visibleIds = new Set(visible.map((v) => v.node.id));

    const rectById = new Map<string, DOMRect>();
    containerRef.current?.querySelectorAll<HTMLElement>('[data-tree-row-id]').forEach((el) => {
      const rowId = el.dataset.treeRowId;
      if (rowId) rectById.set(rowId, el.getBoundingClientRect());
    });
    const midpoints = visible.map((v) => {
      const r = rectById.get(v.node.id);
      return r ? r.top + r.height / 2 : Number.POSITIVE_INFINITY;
    });

    // Initial target: however many visible rows precede where the dragged node originally sat.
    let initialTarget = 0;
    for (const f of flat) {
      if (f.node.id === id) break;
      if (visibleIds.has(f.node.id)) initialTarget += 1;
    }

    dragDataRef.current = {
      activeNode: activeFlat.node,
      activeDepth: activeFlat.depth,
      visible,
      midpoints,
      rowHeight: rectById.get(id)?.height ?? 44,
    };
    setTargetIndex(initialTarget);
    setActiveId(id);
    hapticTap();
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const data = dragDataRef.current;
    if (!data) return;
    const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
    if (!activeRect) return;
    const ghostCenterY = activeRect.top + activeRect.height / 2;

    let newTarget = data.midpoints.length;
    for (let i = 0; i < data.midpoints.length; i++) {
      if (ghostCenterY < data.midpoints[i]) {
        newTarget = i;
        break;
      }
    }
    setTargetIndex(newTarget);

    const result = projectDrop(
      data.visible,
      data.activeNode,
      data.activeDepth,
      newTarget,
      event.delta.x,
      indentWidth,
      maxDepth,
    );
    setProjection(result);
    projectionRef.current = result;
    if (!result.valid && !wasInvalidRef.current) hapticWarning();
    wasInvalidRef.current = !result.valid;

    // Only tick for a genuine slot change while it's actually droppable there — the warning
    // buzz above already covers "you've hit a blocked spot," so this stays a single, subtle cue
    // per position rather than stacking on top of it.
    const slotKey = `${newTarget}:${result.depth}`;
    if (result.valid && lastSlotKeyRef.current !== null && lastSlotKeyRef.current !== slotKey) {
      hapticTap();
    }
    lastSlotKeyRef.current = slotKey;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const finalProjection = projectionRef.current;
    if (finalProjection?.valid) {
      onMove(String(event.active.id), finalProjection.parentId, finalProjection.index);
      hapticTap();
    }
    reset();
  };

  const data = dragDataRef.current;
  const shadowDepth = projection?.depth ?? data?.activeDepth ?? 0;
  // When the shadow would become the first child of the row directly above it, its top border
  // sits exactly on that row's projected-parent ring (see EntryItem/SuggestionNodeEditor) — both
  // are semi-transparent, so the overlap reads as a solid-looking seam instead of two separate
  // dashed/ring edges. Dropping the shadow's own top border there removes the seam; the parent's
  // ring alone still marks the boundary.
  const precedingRow = data?.visible[targetIndex - 1];
  const shadowAdjacentToOwnParent =
    denseRows && !!projection && !!precedingRow && projection.parentId === precedingRow.node.id;
  const shadow = (
    <motion.div key="__shadow__" layout transition={SPRING} style={{ marginLeft: shadowDepth * indentWidth }}>
      <div
        className={cn(
          'rounded-lg border-2 border-dashed',
          // shadowAdjacentToOwnParent && 'rounded-t-none border-t-0',
          shadowAdjacentToOwnParent && 'border-t-0',
          !projection || projection.valid ? 'border-primary/40 bg-primary/5' : 'border-destructive/50 bg-destructive/10',
        )}
        style={{ height: data?.rowHeight ?? 44 }}
      />
    </motion.div>
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <SortableTreeContext.Provider
        value={{ activeId, projectedParentId: projection?.parentId ?? null, projectionValid: projection?.valid ?? true }}
      >
        <div ref={containerRef}>
          {activeId && data ? (
            <div className={listClassName}>
              {(() => {
                // Shadow and rows as flat siblings (not nested inside each other) — that's what
                // lets framer-motion's `layout` FLIP-animate the shadow sliding between
                // positions independently of the rows reflowing around it.
                const items: ReactNode[] = [];
                data.visible.forEach((v, i) => {
                  if (i === targetIndex) items.push(shadow);
                  items.push(
                    <motion.div key={v.node.id} layout transition={SPRING}>
                      {renderRow(v.node, v.depth)}
                    </motion.div>,
                  );
                });
                if (targetIndex === data.visible.length) items.push(shadow);
                return items;
              })()}
            </div>
          ) : (
            children
          )}
        </div>
      </SortableTreeContext.Provider>
      <DragOverlay modifiers={[ghostOffsetModifier]}>
        {activeId && data ? renderGhost(data.activeNode) : null}
      </DragOverlay>
    </DndContext>
  );
}
