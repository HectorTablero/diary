import { z } from 'zod';

/**
 * What a stored icon name may look like: a Lucide name, kebab-case. Anything else is treated as no
 * icon at all.
 *
 * Its own module, free of React, so a plugin's pure model can validate a stored name without pulling
 * the renderer in (the logic test project has no DOM).
 */
export const iconNameSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
