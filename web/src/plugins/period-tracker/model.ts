import type { PluginRecordDto } from '@diary/shared';
import { z } from 'zod';

/**
 * What the period tracker stores, and how it reads it back.
 *
 * One row per day, dateKey-keyed, same shape as a habit's day row and for the same reason: a day is
 * the unit a person actually thinks in ("did my period happen on Tuesday"), so it is also the unit
 * two devices can edit independently without colliding, and the unit a reset payload stays
 * proportional to.
 *
 * There is deliberately no "cycle" row. A cycle — a period's start and end — is never written; it is
 * *derived*, in predict.ts, by scanning for runs of consecutive days marked `period: true`. That is
 * what keeps recording a single tap: marking a day on or off can never leave a stored cycle
 * disagreeing with the days it was supposedly built from, because there is nothing but the days.
 */

/**
 * How heavy a marked day was. Three levels, not the four or five some period-tracking apps offer
 * (adding "spotting") — this plugin's data has exactly two jobs, shading the calendar and feeding the
 * cycle-length average, and both are served just as well by three. A finer scale would be detail this
 * app never reads back.
 */
export const FLOW_LEVELS = ['light', 'medium', 'heavy'] as const;
export type FlowLevel = (typeof FLOW_LEVELS)[number];

/** What a day is marked with, once toggled on and before the user picks otherwise — the middle of
    the scale, so a first tap is never a guess at either extreme. */
export const DEFAULT_FLOW: FlowLevel = 'medium';

const daySchema = z.object({
  period: z.literal(true),
  // `.catch` rather than a hard failure: a row from a future build that adds a fourth level should
  // still read as *some* period day here, not vanish from the history a prediction is built on.
  flow: z.enum(FLOW_LEVELS).catch(DEFAULT_FLOW),
});

export interface PeriodDay {
  flow: FlowLevel;
}

/** A day row, or undefined if this day was never marked (or the row belongs to something else). */
export function parsePeriodDay(record: PluginRecordDto | undefined): PeriodDay | undefined {
  if (!record) return undefined;
  const parsed = daySchema.safeParse(record.data);
  if (!parsed.success) return undefined;
  return { flow: parsed.data.flow };
}

export const periodDayData = (flow: FlowLevel) => ({ period: true as const, flow });

/**
 * How dark a day's calendar cell reads, against the plugin's own reddish hue (see
 * `PluginManifest.hue`).
 *
 * Graded by flow rather than a flat 1 for every confirmed day, now that flow is being recorded
 * anyway — a heavy day and a light one are visibly different at a glance, the same way the entries
 * heatmap already distinguishes a quiet day from a busy one. A *predicted* day reads lighter than
 * anything actually logged, on purpose: it is a guess, and the shading should say so before the
 * tooltip does.
 */
export const CALENDAR_LEVEL: Record<FlowLevel, number> = { light: 0.6, medium: 0.8, heavy: 1 };
export const PREDICTED_CALENDAR_LEVEL = 0.1;
