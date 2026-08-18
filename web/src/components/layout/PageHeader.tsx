import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    // `ml-auto` on the actions rather than `justify-between` on the row: a page whose title
    // collapses at a breakpoint (the Explore pages hide theirs under the bottom tab bar) would
    // otherwise see justify-between fall back to flex-start and drag its buttons to the left.
    <div className={cn('mb-6 flex items-center gap-4', className)}>
      {/* `flex-1` so the heading owns the space between it and the actions, rather than shrinking
          to its text. Invisible on a page whose title is plain text — the actions were already
          pushed right by `ml-auto` — and load-bearing for one that puts a control in the heading:
          the notebook's title is editable in place, and a field only as wide as the words already
          in it is a field you cannot comfortably type a longer name into. */}
      <h1 className="min-w-0 flex-1 text-xl font-semibold tracking-tight">{title}</h1>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-8', className)}>
      {children}
    </div>
  );
}
