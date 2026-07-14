import type { EntryNode } from '@diary/shared';
import { useTranslation } from 'react-i18next';
import { ImportanceDot } from '@/components/entry/ImportanceDot';

/** Compact cursor-following preview shown while dragging an entry (see SortableTreeProvider's
    DragOverlay) — plain text, not the full recursive EntryItem, since a deep subtree would make
    an unreadably tall ghost. */
export function EntryDragGhost({ entry }: { entry: EntryNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-72 items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-lg">
      <ImportanceDot importance={entry.importance} />
      <span className="min-w-0 flex-1 truncate text-sm">{entry.content}</span>
      {entry.children.length > 0 && (
        <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
          {t('diary.subEntries', { count: entry.children.length })}
        </span>
      )}
    </div>
  );
}
