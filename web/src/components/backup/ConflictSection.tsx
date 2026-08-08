import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

/** A row button, raised to the whole section. `selected` mirrors the row buttons' own filled state
    and means the same thing there: this is what the section is set to. */
export interface ConflictBulkButton {
  key: string;
  label: string;
  icon: LucideIcon;
  selected: boolean;
  onApply: () => void;
}

/**
 * One kind's worth of conflicts, as a collapsed block with the row buttons hoisted out of it.
 *
 * The four groups on the review page used to open with a bare `<h2 className="text-sm font-semibold">`
 * and nothing else, which made the page read as one long undifferentiated list of warning cards —
 * the headings were the same weight as the rows they introduced and carried no count, so there was
 * no way to tell a group of two from a group of thirty without scrolling to the end of it.
 *
 * It now starts closed, because the list is the part of this screen that is worth *not* reading.
 * A restore is usually one decision taken thirty times, and the section buttons answer it in one
 * press; the rows underneath are for the minority of cases that need a different answer, and they
 * are one click away when they do. The count is stated twice on purpose, and they are different
 * facts: the badge is how much is left to do, and it disappears when the group is finished. Nothing
 * else on the page can say "this part is done" — the rows themselves go quiet one at a time and the
 * footer only speaks for the total.
 */
export function ConflictSection({
  title,
  icon: Icon,
  total,
  unresolved,
  bulk = [],
  children,
}: {
  title: string;
  icon: LucideIcon;
  total: number;
  unresolved: number;
  bulk?: ConflictBulkButton[];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const done = unresolved === 0;

  return (
    <Collapsible asChild>
      <section className="mb-4">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg py-1 text-left transition-colors hover:text-foreground/80">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{title}</h2>
          {done ? (
            <Badge variant="outline" className="gap-1 text-xs font-normal text-muted-foreground">
              <Check className="size-3" />
              {t('importBackup.sectionDone', { count: total })}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {t('importBackup.sectionRemaining', { count: unresolved })}
            </Badge>
          )}
          {/* The only affordance saying the list is still there. Rotating rather than swapping
              glyphs so the open and closed states are read as one control in two positions. */}
          <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>

        {bulk.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t('importBackup.setAll')}</span>
            {bulk.map((action) => (
              <Button
                key={action.key}
                size="sm"
                variant={action.selected ? 'default' : 'outline'}
                className="h-7 gap-1 text-xs"
                onClick={action.onApply}
              >
                <action.icon className="size-3" />
                {action.label}
              </Button>
            ))}
          </div>
        )}

        <CollapsibleContent>
          <ul className={cn('flex flex-col gap-2', bulk.length > 0 ? 'mt-2' : 'mt-1.5')}>
            {children}
          </ul>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
