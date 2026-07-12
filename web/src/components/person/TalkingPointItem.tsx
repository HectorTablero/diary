import type { TalkingPointNode } from '@diary/shared';
import { subtreeHasMatch } from '@diary/shared';
import { AtSign, Check, ChevronRight, EyeOff, Megaphone, MoreHorizontal, Tag as TagIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSetHidden, useSetSaid } from '@/api/hooks';
import { EntryRow } from '@/components/person/EntryRow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

function countSubtree(node: TalkingPointNode): number {
  return node.children.reduce((sum, c) => sum + countSubtree(c), 1);
}

interface TalkingPointItemProps {
  node: TalkingPointNode;
  personId: string;
  personName: string;
  /** Root entries show their date; nested sub-entries share the root's, so it'd be redundant. */
  depth?: number;
  /** Once a non-matching branch is expanded, render the rest of it flat instead of nesting another toggle. */
  forceExpanded?: boolean;
}

/** Tree-aware row for the person profile's Talking Points tab: matched sub-entries
    are always shown, non-matching branches collapse behind a "+N hidden" toggle,
    and a non-matching ancestor stays visible (as plain context) whenever a
    descendant of it matched. */
export function TalkingPointItem({
  node,
  personId,
  personName,
  depth = 0,
  forceExpanded = false,
}: TalkingPointItemProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const setSaid = useSetSaid();
  const setHidden = useSetHidden();

  const isMatch = node.matchType !== null;
  const forced = forceExpanded ? node.children : node.children.filter(subtreeHasMatch);
  const rest = forceExpanded ? [] : node.children.filter((c) => !subtreeHasMatch(c));
  const hiddenCount = rest.reduce((sum, c) => sum + countSubtree(c), 0);

  const markSaid = () => {
    setSaid.mutate(
      { entryId: node.id, personId, said: true },
      {
        onSuccess: () =>
          toast(t('people.markedSaid'), {
            action: {
              label: t('common.undo'),
              onClick: () => setSaid.mutate({ entryId: node.id, personId, said: false }),
            },
          }),
        onError: () => toast.error(t('errors.unknown')),
      },
    );
  };

  const hide = () => {
    setHidden.mutate(
      { entryId: node.id, personId, hidden: true },
      {
        onSuccess: () =>
          toast(t('people.hideForPerson', { name: personName }), {
            action: {
              label: t('common.undo'),
              onClick: () => setHidden.mutate({ entryId: node.id, personId, hidden: false }),
            },
          }),
        onError: () => toast.error(t('errors.unknown')),
      },
    );
  };

  return (
    <li>
      <div className={cn('rounded-xl pl-3 py-1.5', isMatch ? 'border bg-card shadow-xs' : 'opacity-70')}>
        <EntryRow entry={node} showChips={false} showDate={depth === 0}>
          {isMatch && (
            <div className="flex shrink-0 items-center gap-1">
              <Badge
                variant="outline"
                className="hidden gap-1 text-[11px] text-muted-foreground sm:inline-flex"
              >
                {node.matchType === 'mention' ? (
                  <AtSign className="size-3" />
                ) : node.matchType === 'tag' ? (
                  <TagIcon className="size-3" />
                ) : (
                  <Megaphone className="size-3" />
                )}
                {t(
                  node.matchType === 'mention'
                    ? 'people.matchMention'
                    : node.matchType === 'tag'
                      ? 'people.matchTag'
                      : 'people.matchBroadcast',
                )}
              </Badge>
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={markSaid}>
                <Check className="size-3.5" />
                {t('people.markSaid')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7 text-muted-foreground">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={hide}>
                    <EyeOff className="size-3.5" />
                    {t('people.hideForPerson', { name: personName })}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </EntryRow>
      </div>

      {(forced.length > 0 || rest.length > 0) && (
        <ul className="mt-1 ml-5 border-l border-border/70 pl-1.5">
          {forced.map((child) => (
            <TalkingPointItem
              key={child.id}
              node={child}
              personId={personId}
              personName={personName}
              depth={depth + 1}
              forceExpanded={forceExpanded}
            />
          ))}
          {rest.length > 0 && (
            <li>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => setOpen((o) => !o)}
              >
                <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
                {open ? t('people.hideSubEntries') : t('people.hiddenSubEntries', { count: hiddenCount })}
              </Button>
            </li>
          )}
          {open &&
            rest.map((child) => (
              <TalkingPointItem
                key={child.id}
                node={child}
                personId={personId}
                personName={personName}
                depth={depth + 1}
                forceExpanded
              />
            ))}
        </ul>
      )}
    </li>
  );
}
