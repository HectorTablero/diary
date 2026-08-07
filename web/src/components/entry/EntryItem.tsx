import type { EntryNode } from '@diary/shared';
import { DEFAULT_SUB_ENTRY_DEPTH } from '@diary/shared';
import {
  ChevronRight,
  CornerDownRight,
  GitBranch,
  GripVertical,
  Mic,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeleteEntry, useRestoreEntries, useSettings } from '@/api/hooks';
import { VoiceSubEntryDialog } from '@/components/ai/VoiceSubEntryDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PersonChip, TagChip, ThreadChip } from '@/components/entry/chips';
import { AddToThreadDialog } from '@/components/thread/AddToThreadDialog';
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
import { Separator } from '@/components/ui/separator';
import { notifyError } from '@/lib/notify';
import { notifyDeleted } from '@/lib/undo';
import { usePreferences } from '@/lib/preferences';
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
  ancestors = [],
  voiceEnabled = false,
}: {
  entry: EntryNode;
  depth?: number;
  /** Render just this row, no recursion into children, indented via margin instead of ancestor
      nesting, and non-interactive — used only while a drag is in progress (see
      SortableTreeProvider's renderRow). */
  flat?: boolean;
  /** Contents of this entry's ancestors, outermost first. Threaded down the recursion rather than
      looked up, because the voice sub-entry flow sends the whole chain to the model as context and
      the tree is the only place that knows it. */
  ancestors?: string[];
  /** Whether the ⋯ menu offers voice capture: resolved once in EntryTree so a row doesn't have to
      subscribe to settings/session/sync status just to decide whether to show one menu item. */
  voiceEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const { data: settings } = useSettings();
  const { entriesExpanded } = usePreferences();
  // Only the starting state: collapsing stays per-entry and per-visit, as it always did.
  const [expanded, setExpanded] = useState(entriesExpanded);
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [recordingSub, setRecordingSub] = useState(false);
  const [threading, setThreading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteEntry = useDeleteEntry();
  const restoreEntries = useRestoreEntries();
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

  // The user's own nesting limit, not the shared ceiling: a root sits at depth 0, so an entry can
  // take a child while its own depth is still below it.
  const maxDepth = settings?.maxSubEntryDepth ?? DEFAULT_SUB_ENTRY_DEPTH;
  const canAddSub = depth < maxDepth;

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
          {(chipTags.length > 0 || chipPeople.length > 0 || entry.threads.length > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {chipTags.map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
              {/* Always shown, unlike tags and people: a thread is never a token in the text, so
                  there's no inline copy for a chip to duplicate. */}
              {entry.threads.map((thread) => (
                <ThreadChip key={thread.id} thread={thread} />
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
            {/* `w-auto` rather than a fixed width: DropdownMenuContent otherwise sizes itself to
                the trigger, and a size-7 ⋯ button leaves only the 128px min-width — too tight for
                the sub-entry label plus the mic beside it. Pinning a width instead would leave
                dead space on the right whenever the mic isn't there to fill it, so let the menu
                shrink-to-fit and be exactly as wide as whatever it's actually showing. */}
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> {t('common.edit')}
              </DropdownMenuItem>
              {canAddSub && (
                // Split row: typing and dictating produce the same thing, so the mic sits beside
                // "Add sub-entry" rather than repeating the label on a line of its own. Both halves
                // stay real menu items, so arrow-key navigation and close-on-select still work.
                <div className="flex items-center">
                  {/* `grow`, not `flex-1`: flex-1 zeroes the basis, which makes this row's
                      max-content width — the thing the shrink-to-fit menu is measured against —
                      depend on scaled flex contributions rather than on the label itself. */}
                  <DropdownMenuItem className="min-w-0 grow" onClick={() => setAddingSub(true)}>
                    <CornerDownRight className="size-3.5" />
                    <span className="truncate">{t('diary.addSubEntry')}</span>
                  </DropdownMenuItem>
                  {voiceEnabled && (
                    <>
                      {/* The centring has to be written with the same `data-vertical:` variant the
                          Separator sets `self-stretch` with. A bare `self-center` survives
                          tailwind-merge as a *second* rule and then loses on specificity to the
                          attribute selector — leaving align-self: stretch, which a definite `h-5`
                          turns into flex-start, pinning the bar to the top of the row. */}
                      <Separator
                        orientation="vertical"
                        className="mx-1 h-5 data-vertical:self-center"
                      />
                      <DropdownMenuItem
                        className="justify-center px-2 py-1.5"
                        onClick={() => setRecordingSub(true)}
                        aria-label={t('ai.recordSubEntries')}
                      >
                        <Mic className="size-3.5" />
                      </DropdownMenuItem>
                    </>
                  )}
                </div>
              )}
              <DropdownMenuItem onClick={() => setThreading(true)}>
                <GitBranch className="size-3.5" /> {t('threads.addToThread')}
              </DropdownMenuItem>
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
            <EntryItem
              key={child.id}
              entry={child}
              depth={depth + 1}
              ancestors={[...ancestors, entry.content]}
              voiceEnabled={voiceEnabled}
            />
          ))}
        </div>
      )}

      <AddToThreadDialog entry={entry} open={threading} onOpenChange={setThreading} />

      {recordingSub && (
        <VoiceSubEntryDialog
          open={recordingSub}
          onOpenChange={setRecordingSub}
          dateKey={entry.dateKey}
          parentId={entry.id}
          parentPath={[...ancestors, entry.content]}
        />
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
            // The snapshot covers the whole subtree, so undoing a parent brings its children back
            // with it — which is the only behaviour that matches what the confirm dialog warned about.
            onSuccess: (deletion) =>
              notifyDeleted(t('diary.entryDeleted'), () => restoreEntries.mutateAsync(deletion)),
            onError: () => notifyError(t('errors.unknown')),
          })
        }
      />
    </div>
  );
}
