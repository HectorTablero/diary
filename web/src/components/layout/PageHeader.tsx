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
      <h1 className="min-w-0 text-xl font-semibold tracking-tight">{title}</h1>
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
