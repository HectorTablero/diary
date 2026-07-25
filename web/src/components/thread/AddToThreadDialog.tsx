import type { EntryDto, ThreadDto } from '@diary/shared';
import { MAX_THREADS_PER_ENTRY } from '@diary/shared';
import { GitBranch, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCreateThread, useSetEntryThreads, useThreads } from '@/api/hooks';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/apiClient';

/**
 * Put an existing entry into (or out of) threads. This is the main way threads get built: a topic
 * is usually only recognised as one after several entries about it already exist, so grouping
 * happens after the fact far more often than at compose time.
 *
 * A dialog rather than the EntityPicker popover because both call sites open it from inside a
 * dropdown menu, and nesting a popover in a menu fights over focus.
 */
export function AddToThreadDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: Pick<EntryDto, 'id' | 'threads'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: allThreads = [] } = useThreads();
  const createThread = useCreateThread();
  const setEntryThreads = useSetEntryThreads();
  const [newName, setNewName] = useState('');

  const selected = new Set(entry.threads.map((th) => th.id));
  const atLimit = selected.size >= MAX_THREADS_PER_ENTRY;

  const commit = (threadIds: string[]) =>
    setEntryThreads.mutate(
      { entryId: entry.id, threadIds },
      { onError: () => toast.error(t('errors.unknown')) },
    );

  const toggle = (thread: ThreadDto) => {
    if (selected.has(thread.id)) commit([...selected].filter((id) => id !== thread.id));
    else if (!atLimit) commit([...selected, thread.id]);
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name || createThread.isPending || atLimit) return;
    try {
      const thread = await createThread.mutateAsync({ name });
      commit([...selected, thread.id]);
      setNewName('');
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('threads.addToThread')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {allThreads.length > 0 ? (
            <ul className="-mx-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto px-1">
              {allThreads.map((thread) => {
                const checked = selected.has(thread.id);
                return (
                  <li key={thread.id}>
                    <label
                      className={
                        'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60' +
                        (!checked && atLimit ? ' cursor-not-allowed opacity-50' : '')
                      }
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!checked && atLimit}
                        onCheckedChange={() => toggle(thread)}
                      />
                      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-foreground">{thread.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {thread.entryCount}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <GitBranch className="size-4 shrink-0" />
              {t('threads.noThreadsDescription')}
            </p>
          )}

          {atLimit && (
            <p className="text-xs text-muted-foreground">
              {t('threads.limitReached', { count: MAX_THREADS_PER_ENTRY })}
            </p>
          )}

          <div className="flex items-center gap-2 border-t pt-3">
            <Input
              value={newName}
              placeholder={t('threads.namePlaceholder')}
              disabled={atLimit}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void createAndAdd()}
            />
            <Button
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              aria-label={t('threads.addThread')}
              disabled={!newName.trim() || createThread.isPending || atLimit}
              onClick={() => void createAndAdd()}
            >
              {createThread.isPending ? <Spinner className="size-3.5" /> : <Plus className="size-4" />}
            </Button>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
