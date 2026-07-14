import type { EntryNode } from '@diary/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { useEffect, useState } from 'react';
import { useMoveEntry } from '@/api/hooks';
import { EntryDragGhost } from '@/components/entry/EntryDragGhost';
import { ENTRY_INDENT_WIDTH, EntryItem } from '@/components/entry/EntryItem';
import { SortableTreeProvider } from '@/components/tree/SortableTreeProvider';
import { applyMove } from '@/lib/sortableTree';

const LIST_CLASS_NAME = '-mx-2 flex flex-col';

function findNode(roots: EntryNode[], id: string): EntryNode | null {
  for (const node of roots) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Drag-and-drop-enabled root of the diary day tree. Wraps the same EntryItem recursion the page
    rendered directly before — drag mechanics live in SortableTreeProvider, this just translates
    a resolved drop position into a fractional-index orderKey and persists it. */
export function EntryTree({ entries }: { entries: EntryNode[] }) {
  const moveEntry = useMoveEntry();
  // A drop's real effect only shows up once useMoveEntry's Dexie write + query invalidation +
  // refetch round-trips (all local, but still async) — without this, the drag state clearing
  // instantly on drop made every row snap back to the *stale* `entries` for a beat, then jump to
  // the real new position once the refetch landed. Rendering the already-applied move locally
  // the moment it's dropped removes that revert-then-jump entirely; this clears itself the next
  // time `entries` actually changes (the refetch landing), so it never drifts from real data.
  const [optimisticEntries, setOptimisticEntries] = useState<EntryNode[] | null>(null);
  useEffect(() => setOptimisticEntries(null), [entries]);
  const displayEntries = optimisticEntries ?? entries;

  const handleMove = (activeId: string, newParentId: string | null, newIndex: number) => {
    const siblings = (newParentId === null ? entries : (findNode(entries, newParentId)?.children ?? [])).filter(
      (n) => n.id !== activeId,
    );
    const newOrderKey = generateKeyBetween(siblings[newIndex - 1]?.orderKey ?? null, siblings[newIndex]?.orderKey ?? null);
    setOptimisticEntries(applyMove(entries, activeId, newParentId, newIndex));
    // On failure entries never changes, so the effect above would never clear the optimistic
    // tree on its own — drop it explicitly so a rejected move doesn't stick around forever.
    moveEntry.mutate(
      { id: activeId, newParentId, newOrderKey },
      { onError: () => setOptimisticEntries(null) },
    );
  };

  return (
    <SortableTreeProvider
      roots={displayEntries}
      onMove={handleMove}
      renderGhost={(node) => <EntryDragGhost entry={node} />}
      renderRow={(node, depth) => <EntryItem entry={node} depth={depth} flat />}
      indentWidth={ENTRY_INDENT_WIDTH}
      listClassName={LIST_CLASS_NAME}
      denseRows
    >
      <div className={LIST_CLASS_NAME}>
        {displayEntries.map((entry) => (
          <EntryItem key={entry.id} entry={entry} />
        ))}
      </div>
    </SortableTreeProvider>
  );
}
