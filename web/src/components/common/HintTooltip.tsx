import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isNative } from '@/lib/native';

/**
 * A tooltip that simply isn't there in the Android app.
 *
 * Radix tooltips open on hover and focus only — a touch never opens one — so on the phone they're
 * dead weight: an affordance the user can see but never trigger. Native renders the trigger bare.
 *
 * Which means the tooltip can never be the *only* route to its information. Callers are expected
 * to give native an equivalent (show the text inline, or let a tap reach the same detail).
 */
export function HintTooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  if (isNative) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}
