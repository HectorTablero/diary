/**
 * Which icons a search matches, best first.
 *
 * Pure, so the picker's ranking can be tested without a DOM or the catalog: it is handed the names
 * and the tags and returns names.
 *
 * Every word typed has to match something — the name or one of the tags — so "arrow up" narrows
 * rather than widens. Each word scores by *how* it matched, and the icon's score is the sum, so an
 * icon called what was typed comes before one merely tagged with it:
 *
 *   0  the whole name, or one of its words, is the word  (`bus` for "bus")
 *   1  a word of the name starts with it                  (`bus-front` for "bu")
 *   2  a tag is the word                                  (`bus` for "coach")
 *   3  a tag starts with it
 *   4  it appears anywhere in the name or a tag
 *
 * Ties keep the catalog's order, which is alphabetical — the order the picker shows with no search.
 */

const NAME_EXACT = 0;
const NAME_PREFIX = 1;
const TAG_EXACT = 2;
const TAG_PREFIX = 3;
const ANYWHERE = 4;

function scoreWord(word: string, name: string, tags: readonly string[]): number | null {
  const nameWords = name.split('-');
  if (name === word || nameWords.includes(word)) return NAME_EXACT;
  if (nameWords.some((part) => part.startsWith(word))) return NAME_PREFIX;

  let best: number | null = null;
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower === word) return TAG_EXACT;
    if (best !== TAG_PREFIX && lower.split(/[\s-]+/).some((part) => part.startsWith(word))) {
      best = TAG_PREFIX;
    }
  }
  if (best !== null) return best;

  if (name.includes(word) || tags.some((tag) => tag.toLowerCase().includes(word))) return ANYWHERE;
  return null;
}

/** The words of a query: lowercased, and split on spaces and hyphens the way names are. */
export const queryWords = (query: string): string[] =>
  query
    .toLowerCase()
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);

export function matchIcons(
  names: readonly string[],
  tags: Readonly<Record<string, readonly string[]>>,
  query: string,
): string[] {
  const words = queryWords(query);
  if (!words.length) return [...names];

  const scored: { name: string; score: number; order: number }[] = [];
  names.forEach((name, order) => {
    const iconTags = Object.hasOwn(tags, name) ? tags[name] : [];
    let score = 0;
    for (const word of words) {
      const wordScore = scoreWord(word, name, iconTags);
      if (wordScore === null) return;
      score += wordScore;
    }
    scored.push({ name, score, order });
  });

  return scored.sort((a, b) => a.score - b.score || a.order - b.order).map(({ name }) => name);
}
