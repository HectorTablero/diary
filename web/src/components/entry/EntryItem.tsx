import type { EntryNode } from '@diary/shared';
import { MAX_SUB_ENTRY_DEPTH } from '@diary/shared';
import { ChevronRight, CornerDownRight, GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDeleteEntry } from '@/api/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PersonChip, TagChip } from '@/components/entry/chips';
import { EntryComposer } from '@/components/entry/EntryComposer';
import { EntryContent } from '@/components/entry/EntryContent';
import { ImportanceDot } from '@/components/entry/ImportanceDot';
import { useSortableTreeRow } from '@/components/tree/SortableTreeProvider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fuzzyEquals } from '@/lib/tokens';
import { cn } from '@/lib/utils';

/** Horizontal indent per tree level in the rendered markup below (ml-5 + pl-1.5 on the child
    list) in idle mode — SortableTreeProvider's indentWidth must match this so dragging left/
    right maps to the same depth the user sees. In `flat` mode (during a drag) this same amount
    is applied directly as a left margin instead, since there's no ancestor list nesting to
    provide it. */
export const ENTRY_INDENT_WIDTH = 26;

export function EntryItem({
  entry,
  depth = 0,
  flat = false,
}: {
  entry: EntryNode;
  depth?: number;
  /** Render just this row, no recursion into children, indented via margin instead of ancestor
      nesting, and non-interactive — used only while a drag is in progress (see
      SortableTreeProvider's renderRow). */
  flat?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteEntry = useDeleteEntry();
  const row = useSortableTreeRow(entry.id);

  // Chips only for linked entities that are not already visible as tokens in the text.
  const { chipTags, chipPeople } = useMemo(() => {
    const inline = (name: string, marker: string) => {
      let idx = entry.content.indexOf(marker);
      while (idx !== -1) {
        if (fuzzyEquals(entry.content.slice(idx + 1, idx + 1 + name.length), name)) return true;
        idx = entry.content.indexOf(marker, idx + 1);
      }
      return false;
    };
    return {
      chipTags: entry.tags.filter((tag) => !inline(tag.name, '#')),
      chipPeople: entry.people.filter((p) => !inline(p.name, '@')),
    };
  }, [entry]);

  const canAddSub = depth + 1 < MAX_SUB_ENTRY_DEPTH + 1; // root(0) + up to 3 nested levels

  return (
    <div
      ref={row.setNodeRef}
      data-tree-row-id={entry.id}
      style={flat ? { marginLeft: depth * ENTRY_INDENT_WIDTH } : undefined}
      // Only the ghost and the shadow should visually react while dragging — a flat row is just
      // a reflowing preview of someone else's drag, not interactive (also keeps :hover from
      // ever triggering on it, since pointer-events: none suppresses hover state entirely).
      className={flat ? 'pointer-events-none' : undefined}
    >
      <div
        className={cn(
          'group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40',
          // Indentation alone can't say *which* row at that depth the shadow would nest under
          // when there are several — so highlight the actual projected parent directly.
          row.isProjectedParent &&
            (row.isProjectedParentInvalid
              ? 'ring-2 ring-destructive/50 bg-destructive/5'
              : 'ring-2 ring-primary/50 bg-primary/5'),
        )}
      >
        <button
          type="button"
          {...row.dragHandleProps}
          aria-label={t('diary.dragHandle')}
          className="mt-1.5 flex size-4 shrink-0 touch-none items-center justify-center text-muted-foreground/60 hover:text-muted-foreground"
        >
          <GripVertical className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={t('diary.subEntries', { count: entry.children.length })}
          className={cn(
            'mt-1.75 flex size-3.5 shrink-0 items-center justify-center text-muted-foreground transition-transform',
            entry.children.length === 0 && 'invisible',
            expanded && 'rotate-90',
          )}
        >
          <ChevronRight className="size-3.5" />
        </button>
        <ImportanceDot importance={entry.importance} className="mt-2" />
        <div className="min-w-0 flex-1">
          <EntryContent entry={entry} />
          {(chipTags.length > 0 || chipPeople.length > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {chipTags.map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
              {chipPeople.map((person) => (
                <PersonChip key={person.id} person={person} />
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          {canAddSub && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={() => setAddingSub(true)}
              aria-label={t('diary.addSubEntry')}
            >
              <CornerDownRight className="size-3.5" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7 text-muted-foreground">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> {t('common.edit')}
              </DropdownMenuItem>
              {canAddSub && (
                <DropdownMenuItem onClick={() => setAddingSub(true)}>
                  <CornerDownRight className="size-3.5" /> {t('diary.addSubEntry')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
                <Trash2 className="size-3.5" /> {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!flat && expanded && entry.children.length > 0 && (
        <div className="ml-5 border-l border-border/70 pl-1.5">
          {entry.children.map((child) => (
            <EntryItem key={child.id} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('diary.editEntry')}</DialogTitle>
          </DialogHeader>
          {editing && (
            <EntryComposer
              dateKey={entry.dateKey}
              entry={entry}
              showDateInput={entry.parentId === null}
              autoFocus
              onDone={() => setEditing(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addingSub} onOpenChange={setAddingSub}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('diary.addSubEntry')}</DialogTitle>
          </DialogHeader>
          {addingSub && (
            <EntryComposer
              dateKey={entry.dateKey}
              parentId={entry.id}
              autoFocus
              onDone={() => setAddingSub(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('diary.deleteConfirmTitle')}
        description={t('diary.deleteConfirmDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() =>
          deleteEntry.mutate(entry.id, {
            onSuccess: () => toast.success(t('diary.entryDeleted')),
            onError: () => toast.error(t('errors.unknown')),
          })
        }
      />
    </div>
  );
}
