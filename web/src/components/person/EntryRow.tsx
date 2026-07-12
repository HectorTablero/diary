import type { EntryDto } from '@diary/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PersonChip, TagChip } from '@/components/entry/chips';
import { EntryContent } from '@/components/entry/EntryContent';
import { ImportanceDot } from '@/components/entry/ImportanceDot';
import { formatDateKey } from '@/lib/dates';
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
  const hasChips = showChips && (entry.tags.length > 0 || entry.people.length > 0);
  return (
    <div className="flex items-start gap-2.5">
      <ImportanceDot importance={entry.importance} className="mt-2" />
      <div className="min-w-0 flex-1">
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
            {showChips && entry.tags.map((tag) => <TagChip key={tag.id} tag={tag} />)}
            {showChips && entry.people.map((p) => <PersonChip key={p.id} person={p} />)}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
