/* Pure, dependency-free fuzzy search used by the AI assistant's query_people tool.
   Kept separate from the Mongo models so it's trivially unit-testable. */

export interface SearchablePerson {
  id: string;
  name: string;
  tagNames: string[];
  notes: string;
}

export interface ScoredPerson extends SearchablePerson {
  score: number;
}

/** Same normalization rule as web/src/lib/tokens.ts: NFD, strip diacritics, lowercase. */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const tokenize = (s: string): string[] => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Classic edit-distance DP, O(len(a) * len(b)). Inputs here are short tokens, not full text. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prevRow = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prevRow[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prevRow[0];
    prevRow[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prevRow[j];
      prevRow[j] =
        a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, prevRow[j], prevRow[j - 1]);
      prevDiag = tmp;
    }
  }
  return prevRow[b.length];
}

/** Exact beats prefix beats substring beats fuzzy typo-tolerance; 0 when nothing matches well enough. */
function tokenScore(queryToken: string, targetToken: string): number {
  if (queryToken === targetToken) return 1.0;
  if (targetToken.startsWith(queryToken)) return 0.85;
  if (queryToken.length >= 3 && targetToken.includes(queryToken)) return 0.7;
  const maxLen = Math.max(queryToken.length, targetToken.length);
  if (maxLen === 0) return 0;
  const similarity = 1 - levenshtein(queryToken, targetToken) / maxLen;
  return similarity >= 0.6 ? similarity * 0.9 : 0;
}

/** Best per-query-token match averaged across the query, against a whole text field. */
function fieldScore(query: string, field: string): number {
  if (!field) return 0;
  const queryTokens = tokenize(query);
  const fieldTokens = tokenize(field);
  if (!queryTokens.length || !fieldTokens.length) return 0;
  let total = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const ft of fieldTokens) best = Math.max(best, tokenScore(qt, ft));
    total += best;
  }
  return total / queryTokens.length;
}

/** Name outweighs tags outweighs notes, but all three contribute. */
export function scorePerson(query: string, person: SearchablePerson): number {
  const nameScore = fieldScore(query, person.name);
  const tagsScore = fieldScore(query, person.tagNames.join(' '));
  const notesScore = fieldScore(query, person.notes);
  return 1.0 * nameScore + 0.6 * tagsScore + 0.4 * notesScore;
}

export function searchPeople(query: string, people: SearchablePerson[]): ScoredPerson[] {
  return people
    .map((p) => ({ ...p, score: scorePerson(query, p) }))
    .filter((p) => p.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC-4180-ish CSV the model reads back as a tool result. */
export function searchPeopleCsv(query: string, people: SearchablePerson[]): string {
  const header = 'id,name,tags,notes,score';
  const results = searchPeople(query, people);
  if (!results.length) return `${header}\n# no matches`;
  const rows = results.map((p) => {
    const notes = p.notes.replace(/\r?\n+/g, ' ').slice(0, 200);
    return [p.id, p.name, p.tagNames.join('|'), notes, p.score.toFixed(2)].map(csvField).join(',');
  });
  return [header, ...rows].join('\n');
}
