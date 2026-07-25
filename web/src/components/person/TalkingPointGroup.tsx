import type { TalkingPointNode, ThreadDto } from '@diary/shared';
import { Check, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSetSaidBulk } from '@/api/hooks';
import { TalkingPointItem } from '@/components/person/TalkingPointItem';
import { Button } from '@/components/ui/button';

/**
 * One thread's live talking points under a single header, with one button that marks the lot as
 * said. Ungrouped clusters aren't rendered here at all — the tab falls back to a bare
 * TalkingPointItem for those, so a diary with no threads looks exactly as it did before.
 *
 * The button writes precisely `group.markableIds`, the set computed alongside the rows on screen.
 * Nothing is recorded against the thread itself, which is what keeps two things true: an entry
 * added to this thread tomorrow won't be marked, and neither will a member that has already
 * decayed out of the list.
 */
export function TalkingPointGroup({
  thread,
  clusters,
  markableIds: ids,
  personId,
  personName,
}: {
  thread: ThreadDto;
  clusters: TalkingPointNode[];
  /** The group's `markableIds` — see the note above. */
  markableIds: string[];
  personId: string;
  personName: string;
}) {
  const { t } = useTranslation();
  const setSaidBulk = useSetSaidBulk();

  const markAll = () => {
    if (!ids.length) return;
    setSaidBulk.mutate(
      { entryIds: ids, personId, said: true },
      {
        onSuccess: () =>
          toast(t('threads.markedAllSaid', { count: ids.length, name: thread.name }), {
            action: {
              label: t('common.undo'),
              // Exactly the ids that were written, so undo can't over- or under-reach.
              onClick: () => setSaidBulk.mutate({ entryIds: ids, personId, said: false }),
            },
          }),
        onError: () => toast.error(t('errors.unknown')),
      },
    );
  };

  return (
    <li>
      {/* `border-foreground/20` rather than the default `border`: this outline is what says "these
          rows belong together", so it has to stay visible on a card in both themes. The heading is
          `foreground` for the same reason the chip's name is — it identifies the group. */}
      <section className="rounded-xl border border-foreground/20 bg-muted/30 p-1.5">
        <header className="flex items-center gap-2 px-1.5 pt-0.5 pb-1.5">
          <GitBranch className="size-3.5 shrink-0 text-foreground" />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {thread.name}
          </h3>
          <span className="shrink-0 text-xs text-muted-foreground">
            {t('threads.toTell', { count: ids.length })}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 text-xs"
            disabled={!ids.length || setSaidBulk.isPending}
            onClick={markAll}
          >
            <Check className="size-3.5" />
            {t('threads.markAllSaid')}
          </Button>
        </header>
        <ul className="flex flex-col gap-2">
          {clusters.map((node) => (
            <TalkingPointItem
              key={node.id}
              node={node}
              personId={personId}
              personName={personName}
            />
          ))}
        </ul>
      </section>
    </li>
  );
}
