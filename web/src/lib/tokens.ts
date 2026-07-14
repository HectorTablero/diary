export interface TokenSegment {
  text: string;
  kind: 'text' | 'person' | 'tag';
}

/** NFD, strip diacritics, lowercase. Mirrors `normalize` in server/src/services/personSearch.ts. */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export const fuzzyIncludes = (haystack: string, needle: string) =>
  normalize(haystack).includes(normalize(needle));

export const fuzzyEquals = (a: string, b: string) => normalize(a) === normalize(b);

export interface MatchSegment {
  text: string;
  matched: boolean;
}

/** One merged region of `text` worth showing as search-result context. */
export interface MatchWindow {
  segments: MatchSegment[];
}

/**
 * Finds every fuzzy occurrence of `query` in `text` and collapses them into a handful of
 * "windows" — each is `contextChars` of surrounding text plus every match inside it, so a
 * few hits close together (e.g. a repeated word in a long note) share one snippet instead of
 * each spawning its own overlapping "...before...match...after..." block.
 *
 * Relies on `normalize` preserving string length (NFD decomposition + stripping the combining
 * marks it introduces nets out to the same length as the original for accented Latin text),
 * so an index found in the normalized haystack lines up with the same index in `text`.
 */
export function matchWindows(text: string, query: string, contextChars = 24): MatchWindow[] | null {
  if (!text || !query.trim()) return null;
  const haystack = normalize(text);
  const needle = normalize(query);
  if (!needle) return null;

  const ranges: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    ranges.push({ start: index, end: index + needle.length });
    from = index + needle.length;
  }
  if (ranges.length === 0) return null;

  const windows: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const start = Math.max(0, range.start - contextChars);
    const end = Math.min(text.length, range.end + contextChars);
    const last = windows[windows.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else windows.push({ start, end });
  }

  return windows.map((window) => {
    const segments: MatchSegment[] = [];
    if (window.start > 0) segments.push({ text: '...', matched: false });
    let cursor = window.start;
    for (const range of ranges) {
      if (range.start < window.start || range.end > window.end) continue;
      if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), matched: false });
      segments.push({ text: text.slice(range.start, range.end), matched: true });
      cursor = range.end;
    }
    if (cursor < window.end) segments.push({ text: text.slice(cursor, window.end), matched: false });
    if (window.end < text.length) segments.push({ text: '...', matched: false });
    return { segments };
  });
}

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

/**
 * Rewrite every @/# mention of `oldName` inside `content` to `newName`, using the
 * same longest-name-first matching rule as segmentContent (so an overlapping
 * longer name, e.g. "Ana María" vs "Ana", isn't clobbered).
 */
export function renameMentions(
  content: string,
  marker: '@' | '#',
  names: string[],
  oldName: string,
  newName: string,
): string {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === marker) {
      const rest = content.slice(i + 1);
      const match = sorted.find((n) => fuzzyEquals(rest.slice(0, n.length), n));
      if (match) {
        result += fuzzyEquals(match, oldName) ? marker + newName : content.slice(i, i + 1 + match.length);
        i += 1 + match.length;
        continue;
      }
    }
    result += ch;
    i++;
  }
  return result;
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
