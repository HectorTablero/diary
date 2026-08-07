import { usePreferences } from './preferences';

/**
 * Where a person or a tag goes when you tap it.
 *
 * One module so every surface agrees. A person's name means the same thing whether it is typed
 * inline as `@Ana`, shown as a chip under the entry, or read out of a birthday banner — and until
 * this existed only the banner actually went anywhere, which left the diary→people direction of
 * the app's central relationship with no route through it at all.
 *
 * A tag goes to Search rather than to /tags: the tags page is a list of tag *names*, and what you
 * want when you tap `#work` inside an entry is the other entries about work. Search already reads
 * a `tags` CSV out of its query string, so this is the filter it would have applied anyway.
 *
 * Threads are deliberately absent. ThreadChip takes the same props and could be given a
 * destination in a line, but /threads has no per-thread URL to send it to, and a chip that lands
 * on a list of every thread is a worse answer than a chip that doesn't pretend to be a link.
 */

export const personHref = (personId: string) => `/people/${personId}`;

export const tagHref = (tagId: string) => `/search?tags=${encodeURIComponent(tagId)}`;

/**
 * Destination builders that return `undefined` when the user has turned entity links off, so a
 * call site passes the result straight through to a `to` prop and gets inert text back without
 * branching. A hook rather than bare functions, so toggling the preference repaints immediately.
 */
export function useEntityLinks() {
  const { entityLinks } = usePreferences();
  return {
    enabled: entityLinks,
    personTo: (personId: string | undefined) =>
      entityLinks && personId ? personHref(personId) : undefined,
    tagTo: (tagId: string | undefined) => (entityLinks && tagId ? tagHref(tagId) : undefined),
  };
}
