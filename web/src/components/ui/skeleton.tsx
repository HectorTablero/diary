import { cn } from '@/lib/utils';

// aria-hidden because a skeleton is a *drawing* of content that isn't there yet: without it, three
// or four of these expose three or four empty elements to a screen reader, which is worse than
// silence. The announcement belongs to whatever tells the user something is loading (Spinner's
// role="status"), not to the grey boxes standing in for the result. Overridable via props, since a
// lone skeleton is sometimes the only loading affordance on screen.
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
