import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Modifier,
} from '@dnd-kit/core';
import { motion } from 'framer-motion';
import i18n from 'i18next';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  flattenTree,
  projectAtDepth,
  projectDrop,
  stepKeyboard,
  visibleForDrag,
  type ArrowKey,
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
    /* dnd-kit's own attributes now apply in full, tabIndex 0 included, so the handle is reachable
       by keyboard and Space starts a move (see the KeyboardSensor below). It used to be forced to
       -1 because a *pointer* click also focuses a <button>, and the row revealed its action
       buttons on `:focus-within` — so clicking a grip left them stuck open. That is fixed at the
       other end instead: rows key the reveal off `:focus-visible`, which a mouse click does not
       match. Taking focusability away was never the right half of that trade. */
    dragHandleProps: { ...attributes, ...listeners },
    isProjectedParent,
    isProjectedParentInvalid: isProjectedParent && !ctx?.projectionValid,
  };
}

const SPRING = { type: 'spring', damping: 32, stiffness: 420 } as const;

const ARROW_KEYS: Record<string, ArrowKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

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

/** dnd-kit types the activator as a bare Event; only a keyboard drag carries a KeyboardEvent. */
const isKeyboardEvent = (event: Event | null): boolean =>
  typeof KeyboardEvent !== 'undefined' && event instanceof KeyboardEvent;

/**
 * An element's top from layout alone, summed up the offsetParent chain.
 *
 * Deliberately not getBoundingClientRect: every row is a framer-motion `layout` child, so at the
 * moment we measure, each one is mid-FLIP — sitting under an inverse transform that puts it where
 * it is sliding *from*. A rect would report that, and the drag would resolve positions against a
 * list that is still visually catching up. offsetTop/offsetHeight are layout-only and already show
 * the settled result, which is the geometry a drop actually lands in.
 *
 * The value is offsetParent-relative rather than viewport-relative; the caller anchors it.
 */
const layoutTop = (el: HTMLElement): number => {
  let top = 0;
  for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
    top += node.offsetTop;
  }
  return top;
};

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [targetIndex, setTargetIndex] = useState(0);
  /* Mirrors targetIndex. The announcement callbacks are invoked by dnd-kit during the same
     event as the state update, so reading the state variable there would describe the previous
     position. */
  const targetIndexRef = useRef(0);
  const [projection, setProjection] = useState<DropProjection | null>(null);
  const dragDataRef = useRef<DragData<T> | null>(null);
  const projectionRef = useRef<DropProjection | null>(null);
  const wasInvalidRef = useRef(false);
  // Tracks the last (index, depth) the drag resolved to, so a light tap fires whenever it
  // actually changes — a subtle "still moving, here's your new slot" tick, distinct from the
  // pickup/drop taps and the invalid-transition warning buzz below.
  const lastSlotKeyRef = useRef<string | null>(null);

  /** True for a drag started with the keyboard (Space on the grip) rather than a pointer. */
  const isKeyboardRef = useRef(false);

  const rowElements = (): Map<string, HTMLElement> => {
    const byId = new Map<string, HTMLElement>();
    containerRef.current?.querySelectorAll<HTMLElement>('[data-tree-row-id]').forEach((el) => {
      if (el.dataset.treeRowId) byId.set(el.dataset.treeRowId, el);
    });
    return byId;
  };

  /**
   * Y midpoint of each visible row, in viewport space, as the list is laid out *right now*.
   *
   * Anchoring off the container's own rect is what converts layoutTop's offsetParent-relative
   * numbers into viewport ones: the container is a plain, untransformed div, so its rect is
   * trustworthy, and every row differs from it by layout offsets alone. That also folds in page
   * and ancestor scrolling for free, which walking offsetTop by itself would miss.
   */
  const measureMidpoints = (visible: FlatNode<T>[]): number[] => {
    const container = containerRef.current;
    if (!container) return visible.map(() => Number.POSITIVE_INFINITY);
    const anchor = container.getBoundingClientRect().top - layoutTop(container);
    const byId = rowElements();
    return visible.map((v) => {
      const el = byId.get(v.node.id);
      return el ? anchor + layoutTop(el) + el.offsetHeight / 2 : Number.POSITIVE_INFINITY;
    });
  };

  /**
   * Re-measure whenever the rendered list changes shape.
   *
   * The drag's geometry used to be a single snapshot taken before any of it moved, which stopped
   * describing the screen the moment the drag began: the dragged node's whole subtree leaves the
   * list and a one-row shadow takes its place, so every row below the drag's origin sits
   * `subtreeHeight - rowHeight` higher than the snapshot claimed. For a leaf those cancel, which
   * is why it went unnoticed; for an entry with two children the list was two rows out, and the
   * slots just after a parent — its first and second child — could not be hit at all. Aiming at
   * them resolved two rows late (landing as a third child) or, correcting for that by aiming
   * higher, fell off the parent's other side and became a root above it.
   *
   * targetIndex is the only input that moves rows: the shadow's depth changes an indent, not a
   * height, and no row's height changes during a drag.
   */
  useLayoutEffect(() => {
    const data = dragDataRef.current;
    if (!activeId || !data) return;
    data.midpoints = measureMidpoints(data.visible);
  }, [activeId, targetIndex]);

  /**
   * A keyboard drag is modal — it owns the arrows, Escape and Enter — but only the keyboard can
   * currently end one, and nothing on screen tells a user reaching for the mouse that a move is
   * still in progress. So any press anywhere ends it too.
   *
   * It cancels rather than drops, matching Escape: clicking away from a move is abandoning it, and
   * confirming stays the deliberate Enter/Space. Capture phase so the drag is gone before whatever
   * was clicked reacts — including a grip handle, which would otherwise start a second drag on top
   * of the first.
   *
   * Cancelling by dispatching the key dnd-kit already cancels on, rather than by clearing our own
   * state: dnd-kit owns the drag, and tearing down only this half would leave its sensor attached
   * and its overlay on screen.
   */
  useEffect(() => {
    if (!activeId || !isKeyboardRef.current) return;
    const cancel = () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
      );
    window.addEventListener('pointerdown', cancel, true);
    return () => window.removeEventListener('pointerdown', cancel, true);
  }, [activeId]);

  /** Adopt a resolved position, from whichever input resolved it, with the feedback that goes
      with it. The one place the drag's state is written, so the two inputs can't drift. */
  const commit = (nextIndex: number, next: DropProjection) => {
    setTargetIndex(nextIndex);
    targetIndexRef.current = nextIndex;
    setProjection(next);
    projectionRef.current = next;

    if (!next.valid && !wasInvalidRef.current) hapticWarning();
    wasInvalidRef.current = !next.valid;

    // Only tick for a genuine slot change while it's actually droppable there — the warning
    // buzz above already covers "you've hit a blocked spot," so this stays a single, subtle cue
    // per position rather than stacking on top of it.
    const slotKey = `${nextIndex}:${next.depth}`;
    if (next.valid && lastSlotKeyRef.current !== null && lastSlotKeyRef.current !== slotKey) {
      hapticTap();
    }
    lastSlotKeyRef.current = slotKey;
  };

  /**
   * Arrow keys, resolved as slots rather than as coordinates.
   *
   * A pointer drag has a position that the projection is *derived* from. A keyboard drag has no
   * position at all — no cursor to follow, nothing continuous to track — so it owns the projection
   * directly and this never converts anything to pixels.
   *
   * It used to. It computed the right slot, encoded it as x/y for dnd-kit, and let handleDragMove
   * decode it back out of `delta`. That round trip is lossy: dnd-kit folds scroll compensation
   * into `delta`, and can spend a key press scrolling a container instead of moving at all. So the
   * bounds were applied going in and then re-derived from different numbers coming out, which is
   * why steps went past the depth the row above allowed, past the shallowest legal depth, and why
   * some presses appeared to do nothing whatsoever. Nothing clamps reliably if the value is
   * laundered through a channel that is free to alter it.
   *
   * Returning `currentCoordinates` unchanged keeps dnd-kit's own position fixed (there is nothing
   * for it to move — see the shadow below) while still getting the key preventDefault'd, so the
   * arrows don't scroll the page out from under the drag.
   */
  const coordinateGetter: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
    const data = dragDataRef.current;
    const key = ARROW_KEYS[event.code];
    if (!key || !data) return undefined;
    // No other rows: nothing to reorder against, so the arrows have nothing to do.
    if (!data.visible.length) return currentCoordinates;

    const from = {
      targetIndex: targetIndexRef.current,
      depth: projectionRef.current?.depth ?? data.activeDepth,
    };
    const to = stepKeyboard(data.visible, data.activeNode, from, key, maxDepth);
    commit(
      to.targetIndex,
      projectAtDepth(data.visible, data.activeNode, to.targetIndex, to.depth, maxDepth),
    );
    return currentCoordinates;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter }),
  );

  /* Spoken feedback for a move nobody can see happening. The visual language of this drag —
     a shadow sliding between rows, a ring on the projected parent, red when blocked — conveys
     position and legality entirely in pixels, so all of it has to be said out loud instead.
     Positions are 1-based and depth is called a level, because that is what the indentation
     means to someone who cannot see it. */
  const describePosition = () => {
    const current = projectionRef.current;
    if (!current) return undefined;
    const values = { position: targetIndexRef.current + 1, level: current.depth + 1 };
    return current.valid ? i18n.t('dnd.moved', values) : i18n.t('dnd.blocked', values);
  };

  const announcements: Announcements = {
    onDragStart: () => i18n.t('dnd.lifted'),
    onDragMove: describePosition,
    // Required by the type. This tree resolves its target from coordinates rather than from
    // droppable collisions, so "over" carries no information move hasn't already announced.
    onDragOver: describePosition,
    onDragEnd: () => {
      const current = projectionRef.current;
      if (!current?.valid) return i18n.t('dnd.cancelled');
      return i18n.t('dnd.dropped', {
        position: targetIndexRef.current + 1,
        level: current.depth + 1,
      });
    },
    onDragCancel: () => i18n.t('dnd.cancelled'),
  };

  const reset = () => {
    setActiveId(null);
    setProjection(null);
    dragDataRef.current = null;
    projectionRef.current = null;
    wasInvalidRef.current = false;
    lastSlotKeyRef.current = null;
    targetIndexRef.current = 0;
    isKeyboardRef.current = false;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const flat = flattenTree(roots);
    const activeFlat = flat.find((f) => f.node.id === id);
    if (!activeFlat) return;
    const visible = visibleForDrag(flat, id);
    const visibleIds = new Set(visible.map((v) => v.node.id));

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
      midpoints: measureMidpoints(visible),
      rowHeight: rowElements().get(id)?.offsetHeight ?? 44,
    };
    isKeyboardRef.current = isKeyboardEvent(event.activatorEvent);
    setActiveId(id);

    if (isKeyboardRef.current) {
      /* Start the keyboard drag already holding a projection of where it is *now*. It has no
         pointer to produce a first move, so without this the first arrow press would have no
         current depth to step from, and the card would render for a moment at a position nothing
         had actually resolved. */
      commit(
        initialTarget,
        projectAtDepth(visible, activeFlat.node, initialTarget, activeFlat.depth, maxDepth),
      );
    } else {
      setTargetIndex(initialTarget);
      targetIndexRef.current = initialTarget;
    }
    hapticTap();
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const data = dragDataRef.current;
    if (!data) return;
    /* A keyboard drag resolves its own position in the coordinate getter and holds no meaningful
       coordinates — dnd-kit still reports a move for each key press (that is what preventDefaults
       it), and reading a projection back out of those coordinates would overwrite the slot the
       key press just chose with one decoded from a position nobody set. */
    if (isKeyboardRef.current) return;

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

    commit(
      newTarget,
      projectDrop(
        data.visible,
        data.activeNode,
        data.activeDepth,
        newTarget,
        event.delta.x,
        indentWidth,
        maxDepth,
      ),
    );
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
  /* A keyboard drag puts the preview *inside* the shadow instead of in a floating overlay. With no
     cursor for an overlay to follow, its position would have to be derived from the row geometry —
     and that derivation is exactly what left it sitting off the shadow it was meant to be on.
     Nested in the slot there is nothing left to align: the outline says where the entry would
     land, and the preview inside it says which entry is landing there. */
  const previewInShadow = isKeyboardRef.current;
  const rowHeight = data?.rowHeight ?? 44;
  const blocked = !!projection && !projection.valid;
  const shadow = (
    <motion.div
      key="__shadow__"
      layout
      transition={SPRING}
      style={{ marginLeft: shadowDepth * indentWidth }}
    >
      <div
        className={cn(
          'rounded-lg border-2 border-dashed',
          // shadowAdjacentToOwnParent && 'rounded-t-none border-t-0',
          shadowAdjacentToOwnParent && 'border-t-0',
          // minHeight rather than height below, so a preview taller than the row grows the slot
          // instead of spilling out of it. No horizontal padding: the preview sits flush against
          // the outline's left edge, so its own left edge reads as the slot's.
          previewInShadow && 'flex items-center',
          blocked ? 'border-destructive/50 bg-destructive/10' : 'border-primary/40 bg-primary/5',
        )}
        style={previewInShadow ? { minHeight: rowHeight } : { height: rowHeight }}
      >
        {previewInShadow && data ? renderGhost(data.activeNode) : null}
      </div>
    </motion.div>
  );

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <SortableTreeContext.Provider
        value={{
          activeId,
          projectedParentId: projection?.parentId ?? null,
          projectionValid: projection?.valid ?? true,
        }}
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
        {activeId && data && !previewInShadow ? renderGhost(data.activeNode) : null}
      </DragOverlay>
    </DndContext>
  );
}
