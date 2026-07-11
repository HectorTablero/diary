import type { EntryDto } from '@diary/shared';
import { useMemo } from 'react';
import { segmentContent } from '@/lib/tokens';
import { cn } from '@/lib/utils';

/** Entry text with linked @person / #tag tokens highlighted. */
export function EntryContent({ entry, className }: { entry: EntryDto; className?: string }) {
  const segments = useMemo(
    () =>
      segmentContent(
        entry.content,
        entry.people.map((p) => p.name),
        entry.tags.map((tag) => tag.name),
      ),
    [entry.content, entry.people, entry.tags],
  );

  return (
    <p className={cn('text-sm leading-6 break-words whitespace-pre-wrap', className)}>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <span
            key={i}
            className={cn(
              'font-medium',
              seg.kind === 'person'
                ? 'text-sky-700 dark:text-sky-300'
                : 'text-emerald-700 dark:text-emerald-300',
            )}
          >
            {seg.text}
          </span>
        ),
      )}
    </p>
  );
}
