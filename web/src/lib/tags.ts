import type { TagDto } from '@diary/shared';

/** How many tag chips a person row shows before collapsing the rest into a "+N". */
export const MAX_VISIBLE_TAGS = 4;

export interface VisibleTags {
  shown: TagDto[];
  /** How many were collapsed into the "+N". */
  hidden: number;
}

/**
 * Which of a person's tags to show on their row.
 *
 * With no filter active this is simply the first `MAX_VISIBLE_TAGS`. With one, the tags you
 * filtered on claim the slots first — a person is in the list *because* of those tags, so hiding
 * one behind "+2" while showing three irrelevant ones is perverse. Spare slots then go to the
 * rest, and the winners are rendered back in the person's own order.
 *
 * So the *selection* changes under a filter, but the *order* never does: with a limit of 4,
 * `A b C d (E)` shows `A b C E` — not `A C E b`. A matched tag can still end up in the "+N" when
 * there are more matches than slots (`A b C d (E F G)` → `A C E F`, +3); the rule only maximises
 * how many are visible, it can't conjure extra room.
 */
export function visibleTags(tags: TagDto[], tagFilter: string[]): VisibleTags {
  if (tags.length <= MAX_VISIBLE_TAGS) return { shown: tags, hidden: 0 };
  if (tagFilter.length === 0) {
    return {
      shown: tags.slice(0, MAX_VISIBLE_TAGS),
      hidden: tags.length - MAX_VISIBLE_TAGS,
    };
  }

  const indexed = tags.map((tag, index) => ({ tag, index }));
  const matched = indexed.filter(({ tag }) => tagFilter.includes(tag.id));
  const rest = indexed.filter(({ tag }) => !tagFilter.includes(tag.id));

  // Matched first so they win the slots, then re-sorted by original position so the row still
  // reads in the person's own order.
  const picked = [...matched, ...rest].slice(0, MAX_VISIBLE_TAGS);
  picked.sort((a, b) => a.index - b.index);

  return { shown: picked.map(({ tag }) => tag), hidden: tags.length - picked.length };
}
