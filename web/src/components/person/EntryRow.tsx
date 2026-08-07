import type { EntryDto } from '@diary/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PersonChip, TagChip } from '@/components/entry/chips';
import { EntryContent } from '@/components/entry/EntryContent';
import { ImportanceDot } from '@/components/entry/ImportanceDot';
import { formatDateKey } from '@/lib/dates';
import { useEntityLinks } from '@/lib/entityLinks';
import { cn } from '@/lib/utils';

/** Compact read-only entry row used in profiles, search results and memories. */
export function EntryRow({
  entry,
  crossedOut = false,
  showChips = true,
  showDate = true,
  children,
}: {
  entry: EntryDto;
  crossedOut?: boolean;
  showChips?: boolean;
  /** Off for nested sub-entries in a tree, whose date is already shown on the root. */
  showDate?: boolean;
  children?: React.ReactNode;
}) {
  const { i18n } = useTranslation();
  const { personTo, tagTo } = useEntityLinks();
  const hasChips = showChips && (entry.tags.length > 0 || entry.people.length > 0);
  return (
    <div className="flex items-start gap-2.5">
      <ImportanceDot importance={entry.importance} className="mt-2" />
      <div className="min-w-0 flex-1">
        {/* Floated rather than a flex sibling. As a flex item the action cluster reserved its
            width for the *entire* height of the card, so a long entry — especially in a language
            with long labels, where "Mark as said" is "Marcar como contado" — was squeezed into a
            ribbon barely a dozen characters wide for every one of its lines. A float only shortens
            the line boxes it physically overlaps, so the text takes the full width back as soon as
            it passes below the buttons. Nothing else does this: flex and grid have no concept of
            text flowing around a box.

            Source order is load-bearing — a float only affects content that comes after it, so
            this must stay above EntryContent even though it renders on the right. */}
        {children && (
          <div className="float-right mb-1 ml-2.5 flex items-center gap-1">{children}</div>
        )}
        <EntryContent
          entry={entry}
          className={cn(crossedOut && 'text-muted-foreground line-through')}
        />
        {(showDate || hasChips) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {showDate && (
              <Link
                to={`/diary/${entry.dateKey}`}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {formatDateKey(entry.dateKey, i18n.language, 'd MMM yyyy')}
              </Link>
            )}
            {showChips &&
              entry.tags.map((tag) => <TagChip key={tag.id} tag={tag} to={tagTo(tag.id)} />)}
            {showChips &&
              entry.people.map((p) => <PersonChip key={p.id} person={p} to={personTo(p.id)} />)}
          </div>
        )}
      </div>
    </div>
  );
}
