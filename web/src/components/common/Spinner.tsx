import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/* A spinning icon says "wait" to an eye and nothing at all to a screen reader, so the wrapper is
   the point: role="status" makes it a polite live region, and the sr-only text gives it something
   to announce the moment it mounts. Every call site inherits that — including the ones that render
   a spinner inside a button while a mutation is in flight, where "Loading…" joining the button's
   name for the duration is exactly the intended reading.

   The wrapper is inline-flex rather than display:contents: contents would keep the layout byte-for-
   byte identical, but browsers have a history of dropping display:contents elements out of the
   accessibility tree, which would quietly undo the whole fix. `className` still lands on the icon,
   so the sizes call sites pass keep working. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  const { t } = useTranslation();
  return (
    <span role="status" className="inline-flex shrink-0 items-center">
      <Loader2 aria-hidden className={cn('size-5 animate-spin text-muted-foreground', className)} />
      <span className="sr-only">{label ?? t('common.loading')}</span>
    </span>
  );
}

export function FullScreenSpinner() {
  return (
    // Sized to the shell's content box, not the raw viewport: <main> already adds the top inset
    // and the tab-bar padding, so a full 100dvh here overflows and leaves the loading screen
    // scrollable. Subtracting that chrome keeps it centred and static.
    <div className="flex min-h-[calc(100dvh-var(--inset-top)-var(--inset-bottom)-5.5rem)] items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}
