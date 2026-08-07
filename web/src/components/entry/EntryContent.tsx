import type { EntryDto } from '@diary/shared';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useEntityLinks } from '@/lib/entityLinks';
import { segmentContent } from '@/lib/tokens';
import { cn } from '@/lib/utils';

/**
 * Entry text with its @person / #tag tokens highlighted, and — unless the user has turned entity
 * links off — navigating to what they name.
 *
 * A real `<Link>`, not a span with an onClick. The tokens have always been painted in a link
 * colour at a link weight on every entry on every screen, so anything less than a link is a
 * promise the markup was already making and the app wasn't keeping; and only an anchor gives
 * middle-click, "open in new tab" and a screen reader's link role for free.
 */
export function EntryContent({ entry, className }: { entry: EntryDto; className?: string }) {
  const { personTo, tagTo } = useEntityLinks();
  const segments = useMemo(
    () => segmentContent(entry.content, entry.people, entry.tags),
    [entry.content, entry.people, entry.tags],
  );

  return (
    <p className={cn('text-sm leading-6 break-words whitespace-pre-wrap', className)}>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') return <span key={i}>{seg.text}</span>;
        const tokenClass = cn(
          'font-medium',
          seg.kind === 'person'
            ? 'text-sky-700 dark:text-sky-300'
            : 'text-emerald-700 dark:text-emerald-300',
        );
        const to = seg.kind === 'person' ? personTo(seg.id) : tagTo(seg.id);
        return to ? (
          // Matches the birthday banner on the diary day page, which has always underlined on
          // hover — the two now read the same *and* behave the same.
          <Link key={i} to={to} className={cn(tokenClass, 'underline-offset-2 hover:underline')}>
            {seg.text}
          </Link>
        ) : (
          <span key={i} className={tokenClass}>
            {seg.text}
          </span>
        );
      })}
    </p>
  );
}
