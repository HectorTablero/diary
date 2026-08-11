import { CircleSmall, Droplet, DropletOff, Droplets, type LucideIcon } from 'lucide-react';
import type { FlowLevel } from './model';

/**
 * One glyph per flow level, shared between the day widget's control and the plugin page's per-day
 * intensity list — the same three icons should mean the same three things everywhere this plugin
 * shows a flow, the same way habits' five mood faces are one constant rather than redrawn per call
 * site.
 *
 * Ordered by how much of the icon is "filled": a small dot, one drop, two drops — a progression
 * legible before either language's tooltip has to spell it out.
 */
export const FLOW_ICON: Record<FlowLevel, LucideIcon> = {
  light: CircleSmall,
  medium: Droplet,
  heavy: Droplets,
};

/** Not a flow — the day widget's fourth option, "no period", represented by an absent record. Kept
    beside FLOW_ICON rather than folded into it because `FlowLevel` itself has no "off" member: the
    data model never stores one (see model.ts), only the day widget's control offers it as a choice. */
export const OFF_ICON: LucideIcon = DropletOff;
