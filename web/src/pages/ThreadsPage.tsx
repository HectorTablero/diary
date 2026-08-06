import type { ThreadWithStats } from '@diary/shared';
import { ChevronDown, GitBranch, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateThread,
  useDeleteThread,
  useThreadEntries,
  useThreads,
  useUpdateThread,
} from '@/api/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { BOTTOM_NAV_ONLY, SIDEBAR_ONLY, SIDEBAR_ONLY_SR } from '@/components/layout/ExploreLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { EntryRow } from '@/components/person/EntryRow';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { notifyError, notifySuccess } from '@/lib/notify';
import { ApiError } from '@/lib/apiClient';
import { cn } from '@/lib/utils';

function ThreadFormDialog({
  thread,
  open,
  onOpenChange,
}: {
  thread: ThreadWithStats | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const createThread = useCreateThread();
  const updateThread = useUpdateThread();
  const [name, setName] = useState('');

  // Reset fields each time the dialog opens for a (possibly different) thread.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (open && openedFor !== (thread?.id ?? 'new')) {
    setOpenedFor(thread?.id ?? 'new');
    setName(thread?.name ?? '');
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  const pending = createThread.isPending || updateThread.isPending;

  const submit = async () => {
    if (!name.trim() || pending) return;
    try {
      if (thread) await updateThread.mutateAsync({ id: thread.id, input: { name: name.trim() } });
      else await createThread.mutateAsync({ name: name.trim() });
      notifySuccess(t('threads.threadSaved'));
      onOpenChange(false);
    } catch (err) {
      notifyError(t(err instanceof ApiError ? err.code : 'errors.unknown'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{thread ? t('threads.editThread') : t('threads.addThread')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thread-name">{t('threads.name')}</Label>
            <Input
              id="thread-name"
              value={name}
              autoFocus
              placeholder={t('threads.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submit} disabled={!name.trim() || pending}>
              {pending && <Spinner className="size-3.5" />}
              {t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Member list, loaded only once the row is expanded — a long-running thread can hold hundreds of
    entries and the page shows every thread at once. */
function ThreadMembers({ threadId }: { threadId: string }) {
  const { t } = useTranslation();
  const { data: entries, isLoading } = useThreadEntries(threadId);

  if (isLoading) return <Skeleton className="mt-2 h-10" />;
  if (!entries?.length) {
    return <p className="mt-2 text-xs text-muted-foreground">{t('threads.noEntries')}</p>;
  }
  return (
    <ul className="mt-2 flex flex-col gap-1.5 border-l pl-3">
      {entries.map((entry) => (
        <li key={entry.id}>
          <EntryRow entry={entry} showChips={false} />
        </li>
      ))}
    </ul>
  );
}

function ThreadRow({
  thread,
  onEdit,
  onDelete,
}: {
  thread: ThreadWithStats;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-xl border bg-card px-4 py-3 shadow-xs">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-3">
          {/* Where the tags page shows a colour swatch, a thread shows its icon — same anchor role,
              and `foreground` keeps it legible on the card in both themes. */}
          <GitBranch className="size-4 shrink-0 text-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">{thread.name}</p>
            <p className="text-xs text-muted-foreground">
              {t('threads.entriesCount', { count: thread.entryCount })}
            </p>
          </div>
          {thread.entryCount > 0 && (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={t('threads.showEntries')}
              >
                <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={t('threads.editThread')}
            onClick={onEdit}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label={t('threads.deleteThread')}
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
        <CollapsibleContent>
          {/* Mounted only while open, so the entry query doesn't run for collapsed rows. */}
          {open && <ThreadMembers threadId={thread.id} />}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

export default function ThreadsPage() {
  const { t } = useTranslation();
  const { data: threads, isLoading } = useThreads();
  const deleteThread = useDeleteThread();
  const [editing, setEditing] = useState<ThreadWithStats | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<ThreadWithStats | null>(null);

  return (
    <>
      {/* Only the page's *name* collapses under the bottom tab bar, not the row: the create button
          has to stay reachable, and PageHeader's `ml-auto` keeps it on the right once the h1 has
          nothing but the count left in it. */}
      <PageHeader
        title={
          <span className="flex items-baseline gap-2">
            {/* Under the bottom tab bar the switcher above is what names the page, so the word
                itself only has to reach a screen reader — but it must still reach one, or the
                page would have no heading at all. */}
            <span className={SIDEBAR_ONLY_SR}>{t('threads.title')}</span>
            {threads && threads.length > 0 && (
              <>
                <span
                  className={cn(
                    'flex h-6 min-w-6 items-center justify-center rounded-full bg-muted text-[12px] font-medium text-muted-foreground',
                    SIDEBAR_ONLY,
                  )}
                >
                  <span className="sr-only">{t('threads.count', { count: threads.length })}</span>
                  <span className="px-2">{threads.length}</span>
                </span>
                {/* Spelled out rather than a bare badge here: with the title hidden, a lone number
                    sitting next to a button reads as nothing in particular. */}
                <span className={cn('text-sm font-normal text-muted-foreground', BOTTOM_NAV_ONLY)}>
                  {t('threads.count', { count: threads.length })}
                </span>
              </>
            )}
          </span>
        }
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t('threads.addThread')}
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : threads && threads.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              onEdit={() => {
                setEditing(thread);
                setFormOpen(true);
              }}
              onDelete={() => setDeleting(thread)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={GitBranch}
          title={t('threads.noThreads')}
          description={t('threads.noThreadsDescription')}
        />
      )}

      <ThreadFormDialog thread={editing} open={formOpen} onOpenChange={setFormOpen} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('threads.deleteConfirmTitle', { name: deleting?.name ?? '' })}
        description={t('threads.deleteConfirmDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (!deleting) return;
          deleteThread.mutate(deleting.id, {
            onSuccess: () => notifySuccess(t('threads.threadDeleted')),
            onError: () => notifyError(t('errors.unknown')),
          });
        }}
      />
    </>
  );
}
