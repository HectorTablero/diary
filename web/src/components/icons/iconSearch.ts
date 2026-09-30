import data from './lucide-tags.json';

/**
 * Lucide's English search tags — what finds `piggy-bank` from "savings".
 *
 * Its own lazily-imported module for the same reason as `lucideIcons.ts`, and kept apart from it
 * because the two are needed at different times: the icons whenever a chosen one is drawn, the tags
 * only while the picker is open. ~35 kB brotli that a user who never opens the picker never fetches.
 *
 * English only. See scripts/generateIconTags.ts for where the file comes from.
 */
export const iconTags: Readonly<Record<string, readonly string[]>> = data.tags;
