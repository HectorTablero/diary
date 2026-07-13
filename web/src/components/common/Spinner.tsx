import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-muted-foreground', className)} />;
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
