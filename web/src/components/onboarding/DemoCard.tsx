import type { EntryNode } from '@diary/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EntryRow } from '@/components/person/EntryRow';
import { EntityLinksContext } from '@/lib/entityLinks';
import { cn } from '@/lib/utils';

/**
 * The frame around every piece of fake diary in the tour.
 *
 * Two jobs, both about honesty. It says "Example" to a screen reader, because without it the tour
 * reads as somebody else's diary dropped into the middle of a sign-in flow with nothing marking it
 * as illustrative. And it forces entity links off for its subtree, so the @mention and #tag chips
 * inside — which name a person and a tag that do not exist — render as inert coloured text instead
 * of as links that would navigate out of the tour and abandon it with the flag unwritten.
 *
 * The caption is `sr-only` rather than drawn: the card is visibly a mock (it sits under a heading
 * introducing it, on a screen that is plainly a tour), and a visible "Example" label on every panel
 * would be the kind of chrome that makes an onboarding feel like a manual.
 */
export function DemoCard({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <EntityLinksContext value={false}>
      <div className={cn('rounded-xl border bg-card p-3 shadow-xs', className)}>
        <span className="sr-only">{t('onboarding.exampleLabel')}</span>
        {children}
      </div>
    </EntityLinksContext>
  );
}

/**
 * The demo entry and its sub-entries, rendered through the app's own `EntryRow`.
 *
 * Not `EntryTree`/`EntryItem`, which need a SortableTreeProvider, a session and live settings, and
 * not a bespoke row either — `EntryRow` is already the compact read-only presentation used on
 * profiles and in search, it takes a literal `EntryDto`, and going through it means the importance
 * marker, the token highlighting and the chips in the tour are the *same code* the diary runs. A
 * hand-rolled preview would be free to drift into teaching an interface that no longer exists.
 *
 * `showDate={false}` throughout: the date is an ungated `<Link>` inside EntryRow (the entity-link
 * preference deliberately doesn't cover it), and the demo has no day to land on anyway.
 *
 * The indent matches EntryItem's real one (`ml-5 border-l pl-1.5`) so the nesting reads the same
 * here as it will on the diary page.
 */
export function DemoEntry({ entry, saidChildIds }: { entry: EntryNode; saidChildIds?: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <EntryRow entry={entry} showDate={false} crossedOut={saidChildIds?.includes(entry.id)} />
      {entry.children.length > 0 && (
        <div className="ml-5 flex flex-col gap-2 border-l border-border/70 pl-1.5">
          {entry.children.map((child) => (
            <EntryRow
              key={child.id}
              entry={child}
              showDate={false}
              showChips={false}
              crossedOut={saidChildIds?.includes(child.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
