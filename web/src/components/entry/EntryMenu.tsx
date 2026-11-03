import type { EntryDto } from '@diary/shared';
import { IMPORTANCE_LEVELS } from '@diary/shared';
import { Copy, GitBranch, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeleteEntry, useThreadsEnabled, useUpdateEntry } from '@/api/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EditEntryDialog } from '@/components/entry/EntryComposer';
import { useImportanceMarkerClass } from '@/components/entry/ImportanceDot';
import { AddToThreadDialog } from '@/components/thread/AddToThreadDialog';
import { ContextMenu } from '@/components/ui/context-menu';
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { notifyError, notifySuccess } from '@/lib/notify';
import { notifyDeleted } from '@/lib/undo';
import { cn } from '@/lib/utils';

/** The right-click-only quick tweaks every entry menu ends with: set importance, copy the text.
    Shared with the diary's own rows (EntryItem) so the two menus can't drift apart. */
export function EntryQuickItems({
  entry,
}: {
  entry: Pick<EntryDto, 'id' | 'importance' | 'content'>;
}) {
  const { t } = useTranslation();
  const updateEntry = useUpdateEntry();
  const markerClass = useImportanceMarkerClass();
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <span className={cn('size-2.5', markerClass(entry.importance))} />
          {t('importance.label')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={String(entry.importance)}
            onValueChange={(value) =>
              updateEntry.mutate(
                { id: entry.id, input: { importance: Number(value) } },
                { onError: () => notifyError(t('errors.unknown')) },
              )
            }
          >
            {IMPORTANCE_LEVELS.map((level) => (
              <DropdownMenuRadioItem key={level} value={String(level)}>
                <span className={cn('size-2.5', markerClass(level))} />
                {t(`importance.levels.${level}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        onClick={() =>
          void navigator.clipboard.writeText(entry.content).then(
            () => notifySuccess(t('common.copied')),
            () => notifyError(t('errors.unknown')),
          )
        }
      >
        <Copy className="size-3.5" /> {t('common.copyText')}
      </DropdownMenuItem>
    </>
  );
}

/**
 * Right-click menu for an entry shown outside the diary tree — search results, a person's tabs,
 * a thread's members, On this day. Edit, thread, importance, copy and delete, the same as on the
 * entry's own day; `extra` puts whatever the surrounding list is about (mark as said, remove from
 * thread) at the top.
 *
 * Wraps rather than lives inside EntryRow: the onboarding tour renders EntryRow over demo data that
 * must not be editable, and a wrapper can cover a whole card, padding included.
 */
export function EntryMenu({
  entry,
  extra,
  disabled,
  children,
}: {
  entry: EntryDto;
  extra?: ReactNode;
  disabled?: boolean;
  children: ReactElement;
}) {
  const { t } = useTranslation();
  const threadsOn = useThreadsEnabled();
  const deleteEntry = useDeleteEntry();
  const [editing, setEditing] = useState(false);
  const [threading, setThreading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      <ContextMenu
        disabled={disabled}
        menu={
          <>
            {extra && (
              <>
                {extra}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" /> {t('common.edit')}
            </DropdownMenuItem>
            {threadsOn && (
              <DropdownMenuItem onClick={() => setThreading(true)}>
                <GitBranch className="size-3.5" /> {t('threads.addToThread')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="size-3.5" /> {t('common.delete')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <EntryQuickItems entry={entry} />
          </>
        }
      >
        {children}
      </ContextMenu>
      <EditEntryDialog entry={entry} open={editing} onOpenChange={setEditing} />
      <AddToThreadDialog entry={entry} open={threading} onOpenChange={setThreading} />
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('diary.deleteConfirmTitle')}
        description={t('diary.deleteConfirmDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() =>
          deleteEntry.mutate(entry.id, {
            onSuccess: (deletion) => notifyDeleted(t('diary.entryDeleted'), deletion),
            onError: () => notifyError(t('errors.unknown')),
          })
        }
      />
    </>
  );
}
