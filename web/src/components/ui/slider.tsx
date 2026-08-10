'use client';

import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/* A single-thumb range control. Radix handles the keyboard and pointer behaviour, including drag
   from anywhere on the track — which is the whole reason a slider is worth having over a stepper for
   a value the user judges rather than counts.

   The thumb's hit area is deliberately larger than it looks (`after:-inset-2`), matching the switch:
   at 16px the visible dot is well under the 24px minimum a finger needs. */
function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { 'aria-label': string }) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'relative flex w-full touch-none items-center select-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="relative block size-4 rounded-full border border-primary/40 bg-background shadow-xs transition-colors after:absolute after:-inset-2 hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" />
    </SliderPrimitive.Root>
  );
}

export { Slider };
