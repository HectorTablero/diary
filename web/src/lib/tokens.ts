export interface TokenSegment {
  text: string;
  kind: 'text' | 'person' | 'tag';
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export const fuzzyIncludes = (haystack: string, needle: string) =>
  normalize(haystack).includes(normalize(needle));

export const fuzzyEquals = (a: string, b: string) => normalize(a) === normalize(b);

/**
 * Split content into text/person/tag segments by matching linked entity names
 * after @ / # markers (longest name wins, so "Ana María" beats "Ana").
 */
export function segmentContent(
  content: string,
  personNames: string[],
  tagNames: string[],
): TokenSegment[] {
  const people = [...personNames].sort((a, b) => b.length - a.length);
  const tags = [...tagNames].sort((a, b) => b.length - a.length);
  const segments: TokenSegment[] = [];
  let i = 0;
  let last = 0;

  while (i < content.length) {
    const ch = content[i];
    if (ch === '@' || ch === '#') {
      const names = ch === '@' ? people : tags;
      const rest = content.slice(i + 1);
      const match = names.find((n) => fuzzyEquals(rest.slice(0, n.length), n));
      if (match) {
        if (last < i) segments.push({ text: content.slice(last, i), kind: 'text' });
        segments.push({
          text: content.slice(i, i + 1 + match.length),
          kind: ch === '@' ? 'person' : 'tag',
        });
        i += 1 + match.length;
        last = i;
        continue;
      }
    }
    i++;
  }
  if (last < content.length) segments.push({ text: content.slice(last), kind: 'text' });
  return segments;
}

export interface ActiveToken {
  type: '@' | '#';
  query: string;
  start: number;
}

/** The @/# token the caret is currently inside, if any. */
export function detectActiveToken(value: string, caret: number): ActiveToken | null {
  const before = value.slice(0, caret);
  const match = before.match(/[@#][^\s@#]*$/);
  if (!match) return null;
  const start = caret - match[0].length;
  // Don't trigger inside words (e.g. emails).
  if (start > 0 && /[\w@#]/.test(value[start - 1])) return null;
  return { type: match[0][0] as '@' | '#', query: match[0].slice(1), start };
}
